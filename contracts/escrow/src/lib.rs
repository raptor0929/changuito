#![no_std]

//! Escrow for a grocery basket paid in USDC.
//!
//! The gap this exists to cover: the agent takes the shopper's money when they
//! press confirm, but the groceries are not secured until the basket actually
//! clears the supermarket's checkout. In between, a price can move, an item can
//! go out of stock, or the store can reject the whole cart. Something has to
//! hold the money across that gap and be able to give it back.
//!
//! ```text
//!   open(buyer, order_id, amount, basket_hash)   USDC: buyer    -> contract
//!     |
//!     +-- basket confirmed  -> settle(order_id, receipt_hash)   -> treasury
//!     |
//!     +-- basket failed     -> refund(caller, order_id)         -> buyer
//! ```
//!
//! Three properties a plain transfer does not have:
//!
//! 1. The money is recoverable. A failed basket refunds without anyone's goodwill.
//! 2. The basket is committed. `basket_hash` pins the exact items and total the
//!    shopper approved, so the resolver cannot settle against a different one.
//! 3. The receipt is auditable. `settle` stores the store order's hash, and both
//!    transitions emit events.
//!
//! And the property that stops it being a custodial box with extra steps: after
//! `deadline`, the buyer can refund themselves. The resolver's cooperation is
//! required for the happy path only.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token, Address, BytesN, Env,
};

/// Ledger entries are rent-bearing. An order must outlive the shopping trip it
/// belongs to, with enough margin that a refund is still possible days later.
const ORDER_TTL: u32 = 17_280 * 30; // ~30 days at 5s ledgers
const ORDER_TTL_THRESHOLD: u32 = 17_280 * 25;
const INSTANCE_TTL: u32 = 17_280 * 60;
const INSTANCE_TTL_THRESHOLD: u32 = 17_280 * 50;

/// Bounds on `timeout_secs`, so a caller cannot set a deadline that has already
/// passed (instant self-refund) or one so far out the money is effectively gone.
const MIN_TIMEOUT: u64 = 300; // 5 minutes
const MAX_TIMEOUT: u64 = 30 * 24 * 60 * 60; // 30 days

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    OrderExists = 3,
    OrderNotFound = 4,
    /// The order is no longer Open: already settled, or already refunded.
    OrderClosed = 5,
    /// Neither the resolver nor, after the deadline, the buyer.
    NotAuthorized = 6,
    InvalidAmount = 7,
    InvalidTimeout = 8,
    /// `settle` was given a basket that is not the one the buyer approved.
    BasketMismatch = 9,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Open = 0,
    Settled = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub buyer: Address,
    /// In the token's own units. USDC on Stellar has 7 decimals.
    pub amount: i128,
    /// Hash of the exact basket the buyer approved.
    pub basket_hash: BytesN<32>,
    pub status: Status,
    pub opened_at: u64,
    /// Unix seconds after which the buyer may refund themselves.
    pub deadline: u64,
    /// Hash of the store's order, set by `settle`. Zero until then.
    pub receipt_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Settles and refunds on the happy paths. The app's backend.
    pub resolver: Address,
    /// Where a settled basket's USDC lands.
    pub treasury: Address,
    /// The SEP-41 token this escrow holds. Fixed at deploy.
    pub token: Address,
}

#[contracttype]
enum Key {
    Config,
    /// One entry per order id.
    Order(BytesN<32>),
}

#[contractevent]
#[derive(Clone)]
pub struct Opened {
    #[topic]
    pub order_id: BytesN<32>,
    #[topic]
    pub buyer: Address,
    pub amount: i128,
    pub basket_hash: BytesN<32>,
    pub deadline: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct Settled {
    #[topic]
    pub order_id: BytesN<32>,
    #[topic]
    pub buyer: Address,
    pub amount: i128,
    pub receipt_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct Refunded {
    #[topic]
    pub order_id: BytesN<32>,
    #[topic]
    pub buyer: Address,
    pub amount: i128,
    /// True when the buyer took the money back themselves after the deadline,
    /// rather than the resolver releasing it. Worth distinguishing in an audit:
    /// it means the backend never came back.
    pub self_service: bool,
}

#[contract]
pub struct Escrow;

#[contractimpl]
impl Escrow {
    /// Set once, at deploy. The token cannot be changed afterwards — an escrow
    /// that can be pointed at a different asset while holding funds is not one.
    pub fn __constructor(env: Env, resolver: Address, treasury: Address, token: Address) {
        if env.storage().instance().has(&Key::Config) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&Key::Config, &Config { resolver, treasury, token });
        env.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    }

    pub fn config(env: Env) -> Config {
        Self::cfg(&env)
    }

    /// Lock `amount` of the escrow's token against `order_id`.
    ///
    /// The buyer authorizes this call, which is also what authorizes the
    /// transfer out of their balance: `require_auth` here and `transfer` below
    /// are covered by the same signature.
    pub fn open(
        env: Env,
        buyer: Address,
        order_id: BytesN<32>,
        amount: i128,
        basket_hash: BytesN<32>,
        timeout_secs: u64,
    ) -> Order {
        buyer.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if !(MIN_TIMEOUT..=MAX_TIMEOUT).contains(&timeout_secs) {
            panic_with_error!(&env, Error::InvalidTimeout);
        }
        // Order ids are not reused, so an existing one means a double-submit,
        // and overwriting it would strand whatever the first one locked.
        if env.storage().persistent().has(&Key::Order(order_id.clone())) {
            panic_with_error!(&env, Error::OrderExists);
        }

        let cfg = Self::cfg(&env);
        let now = env.ledger().timestamp();
        let order = Order {
            buyer: buyer.clone(),
            amount,
            basket_hash: basket_hash.clone(),
            status: Status::Open,
            opened_at: now,
            deadline: now + timeout_secs,
            receipt_hash: BytesN::from_array(&env, &[0u8; 32]),
        };

        token::TokenClient::new(&env, &cfg.token).transfer(
            &buyer,
            &env.current_contract_address(),
            &amount,
        );

        Self::put(&env, &order_id, &order);
        Opened {
            order_id,
            buyer,
            amount,
            basket_hash,
            deadline: order.deadline,
        }
        .publish(&env);

        order
    }

    /// Release the money to the treasury, recording which basket and which
    /// store order it paid for.
    ///
    /// `basket_hash` is passed back rather than read from storage so that a
    /// resolver settling the wrong order fails loudly instead of quietly
    /// paying for a basket the buyer never saw.
    pub fn settle(
        env: Env,
        order_id: BytesN<32>,
        basket_hash: BytesN<32>,
        receipt_hash: BytesN<32>,
    ) -> Order {
        let cfg = Self::cfg(&env);
        cfg.resolver.require_auth();

        let mut order = Self::get(&env, &order_id);
        if order.status != Status::Open {
            panic_with_error!(&env, Error::OrderClosed);
        }
        if order.basket_hash != basket_hash {
            panic_with_error!(&env, Error::BasketMismatch);
        }

        // Written before the transfer: a token whose `transfer` re-enters this
        // contract must find the order already closed.
        order.status = Status::Settled;
        order.receipt_hash = receipt_hash.clone();
        Self::put(&env, &order_id, &order);

        token::TokenClient::new(&env, &cfg.token).transfer(
            &env.current_contract_address(),
            &cfg.treasury,
            &order.amount,
        );

        Settled {
            order_id,
            buyer: order.buyer.clone(),
            amount: order.amount,
            receipt_hash,
        }
        .publish(&env);

        order
    }

    /// Return the money to the buyer.
    ///
    /// The resolver may do this at any time — that is the normal path when a
    /// basket fails. The buyer may do it themselves once `deadline` has passed,
    /// which is what makes this an escrow rather than a deposit.
    ///
    /// `caller` is explicit because the two cases authorize different addresses,
    /// and `require_auth` has to be called on the one that actually signed.
    pub fn refund(env: Env, caller: Address, order_id: BytesN<32>) -> Order {
        caller.require_auth();

        let cfg = Self::cfg(&env);
        let mut order = Self::get(&env, &order_id);
        if order.status != Status::Open {
            panic_with_error!(&env, Error::OrderClosed);
        }

        let by_resolver = caller == cfg.resolver;
        let by_buyer_after_deadline =
            caller == order.buyer && env.ledger().timestamp() >= order.deadline;
        if !by_resolver && !by_buyer_after_deadline {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        order.status = Status::Refunded;
        Self::put(&env, &order_id, &order);

        token::TokenClient::new(&env, &cfg.token).transfer(
            &env.current_contract_address(),
            &order.buyer,
            &order.amount,
        );

        Refunded {
            order_id,
            buyer: order.buyer.clone(),
            amount: order.amount,
            self_service: !by_resolver,
        }
        .publish(&env);

        order
    }

    pub fn get_order(env: Env, order_id: BytesN<32>) -> Order {
        Self::get(&env, &order_id)
    }

    /// `get_order` panics on an unknown id; this is for callers that are asking
    /// whether an order exists at all, such as a UI polling after a submit.
    /// Not named `try_get_order`: the generated client reserves that prefix for
    /// its own non-panicking wrapper of `get_order`.
    pub fn find_order(env: Env, order_id: BytesN<32>) -> Option<Order> {
        env.storage().persistent().get(&Key::Order(order_id))
    }

    fn cfg(env: &Env) -> Config {
        env.storage()
            .instance()
            .get(&Key::Config)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn get(env: &Env, order_id: &BytesN<32>) -> Order {
        let key = Key::Order(order_id.clone());
        let order: Order = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::OrderNotFound));
        env.storage()
            .persistent()
            .extend_ttl(&key, ORDER_TTL_THRESHOLD, ORDER_TTL);
        order
    }

    fn put(env: &Env, order_id: &BytesN<32>, order: &Order) {
        let key = Key::Order(order_id.clone());
        env.storage().persistent().set(&key, order);
        env.storage()
            .persistent()
            .extend_ttl(&key, ORDER_TTL_THRESHOLD, ORDER_TTL);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    }
}

mod test;
