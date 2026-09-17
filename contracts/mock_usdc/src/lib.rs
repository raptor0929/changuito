#![no_std]

//! A SEP-41 token standing in for USDC on testnet.
//!
//! Why this exists rather than a real asset:
//!
//! Circle does not issue USDC on testnet, and the Blend mock this project
//! first probed has an admin we do not control — and has since vanished in a
//! testnet reset. So the faucet needs a token it can actually mint.
//!
//! The obvious alternative is a classic Stellar asset wrapped as a SAC, which
//! would be the canonical thing to do. It fails on one detail: a classic asset
//! cannot reach an account that has no trustline for it, so every visitor
//! would have to sign a `changeTrust` before the faucet could give them
//! anything. "Press Fund, get USDC" is the whole point of the widget. A
//! SEP-41 contract keeps balances in its own storage, so a mint to a brand new
//! address just works.
//!
//! Minting is admin-only. A permissionless faucet on a public demo is a
//! faucet someone empties for fun.
//!
//! It is labelled "demo USDC" everywhere it is shown. It is not USDC, it is
//! not redeemable, and it carries the symbol only so the escrow is exercised
//! against something shaped like the real asset.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token, Address, Env, MuxedAddress, String,
};

/// USDC's decimals on Stellar. The escrow and the UI both assume this.
const DECIMALS: u32 = 7;

const BALANCE_TTL: u32 = 17_280 * 90;
const BALANCE_TTL_THRESHOLD: u32 = 17_280 * 80;
const INSTANCE_TTL: u32 = 17_280 * 90;
const INSTANCE_TTL_THRESHOLD: u32 = 17_280 * 80;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// Amounts are unsigned in meaning even though the type is i128.
    NegativeAmount = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
    /// An allowance that expires in the past can never be spent.
    ExpirationInPast = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
enum Key {
    Admin,
    Balance(Address),
    Allowance(AllowanceKey),
}

#[contractevent]
#[derive(Clone)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct SetAdmin {
    #[topic]
    pub new_admin: Address,
}

#[contract]
pub struct MockUsdc;

#[contractimpl]
impl MockUsdc {
    pub fn __constructor(env: Env, admin: Address) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    }

    /// The faucet. Admin-only, because a public demo with an open mint is a
    /// demo someone mints a trillion of for fun.
    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::admin_addr(&env).require_auth();
        Self::check_amount(&env, amount);

        Self::set_balance(&env, &to, Self::balance_of(&env, &to) + amount);
        Mint { to, amount }.publish(&env);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        Self::admin_addr(&env).require_auth();
        env.storage().instance().set(&Key::Admin, &new_admin);
        env.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
        SetAdmin { new_admin }.publish(&env);
    }

    pub fn admin(env: Env) -> Address {
        Self::admin_addr(&env)
    }

    fn admin_addr(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Key::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn check_amount(env: &Env, amount: i128) {
        if amount < 0 {
            panic_with_error!(env, Error::NegativeAmount);
        }
    }

    fn balance_of(env: &Env, id: &Address) -> i128 {
        let key = Key::Balance(id.clone());
        match env.storage().persistent().get::<_, i128>(&key) {
            Some(b) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_TTL);
                b
            }
            // An address with no entry has never held any. Absent and zero are
            // the same thing, and not writing zeros keeps the ledger smaller.
            None => 0,
        }
    }

    fn set_balance(env: &Env, id: &Address, amount: i128) {
        let key = Key::Balance(id.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_TTL);
    }

    fn spend(env: &Env, from: &Address, amount: i128) {
        let balance = Self::balance_of(env, from);
        if balance < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        Self::set_balance(env, from, balance - amount);
    }

    fn allowance_of(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        let key = Key::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        match env.storage().temporary().get::<_, AllowanceValue>(&key) {
            // An expired allowance reads as zero rather than as its old value.
            // The entry may still be here: temporary storage expires on its own
            // schedule, not on the one the approver chose.
            Some(a) if a.expiration_ledger < env.ledger().sequence() => AllowanceValue {
                amount: 0,
                expiration_ledger: a.expiration_ledger,
            },
            Some(a) => a,
            None => AllowanceValue { amount: 0, expiration_ledger: 0 },
        }
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        let current = Self::allowance_of(env, from, spender);
        if current.amount < amount {
            panic_with_error!(env, Error::InsufficientAllowance);
        }
        Self::write_allowance(
            env,
            from,
            spender,
            current.amount - amount,
            current.expiration_ledger,
        );
    }

    fn write_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        let key = Key::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        env.storage()
            .temporary()
            .set(&key, &AllowanceValue { amount, expiration_ledger });

        if amount > 0 {
            // Live exactly as long as the approver said, no longer.
            let ttl = expiration_ledger.saturating_sub(env.ledger().sequence());
            if ttl > 0 {
                env.storage().temporary().extend_ttl(&key, ttl, ttl);
            }
        }
    }
}

#[contractimpl]
impl token::Interface for MockUsdc {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        MockUsdc::allowance_of(&env, &from, &spender).amount
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        MockUsdc::check_amount(&env, amount);
        // Zero is allowed with any expiration: revoking must always be possible.
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            panic_with_error!(&env, Error::ExpirationInPast);
        }

        MockUsdc::write_allowance(&env, &from, &spender, amount, expiration_ledger);
        Approve { from, spender, amount, expiration_ledger }.publish(&env);
    }

    fn balance(env: Env, id: Address) -> i128 {
        MockUsdc::balance_of(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        MockUsdc::check_amount(&env, amount);

        // The mux id is a routing detail for the recipient's own accounting.
        // The balance belongs to the underlying address.
        let to = to.address();
        MockUsdc::spend(&env, &from, amount);
        MockUsdc::set_balance(&env, &to, MockUsdc::balance_of(&env, &to) + amount);
        Transfer { from, to, amount }.publish(&env);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        MockUsdc::check_amount(&env, amount);

        MockUsdc::spend_allowance(&env, &from, &spender, amount);
        MockUsdc::spend(&env, &from, amount);
        MockUsdc::set_balance(&env, &to, MockUsdc::balance_of(&env, &to) + amount);
        Transfer { from, to, amount }.publish(&env);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        MockUsdc::check_amount(&env, amount);

        MockUsdc::spend(&env, &from, amount);
        Burn { from, amount }.publish(&env);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        MockUsdc::check_amount(&env, amount);

        MockUsdc::spend_allowance(&env, &from, &spender, amount);
        MockUsdc::spend(&env, &from, amount);
        Burn { from, amount }.publish(&env);
    }

    fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    fn name(env: Env) -> String {
        // Named so that nobody who looks at a wallet can mistake it for the
        // real thing, while the symbol stays USDC so the escrow is exercised
        // against an asset shaped like the one it would hold in production.
        String::from_str(&env, "Demo USDC (changuito testnet)")
    }

    fn symbol(env: Env) -> String {
        String::from_str(&env, "USDC")
    }
}

mod test;
