#![cfg(test)]

//! A token is only useful if it is the boring, correct one. These tests are
//! about the places a hand-written SEP-41 usually goes wrong: allowances that
//! outlive their expiry, a spend that checks the balance after debiting it,
//! and a mint anyone can call.

extern crate std;

use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{token, Address, Env, IntoVal, InvokeError};

use crate::{Error, MockUsdc, MockUsdcClient};

const ONE: i128 = 10_000_000; // 1.0 at 7 decimals

fn rejected(e: Error) -> Result<soroban_sdk::Error, InvokeError> {
    Ok(e.into())
}

struct Fixture<'a> {
    env: Env,
    addr: Address,
    client: MockUsdcClient<'a>,
    token: token::Client<'a>,
    admin: Address,
    alice: Address,
    bob: Address,
}

impl Fixture<'_> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let addr = env.register(MockUsdc, (&admin,));
        Self {
            client: MockUsdcClient::new(&env, &addr),
            token: token::Client::new(&env, &addr),
            addr,
            env,
            admin,
            alice,
            bob,
        }
    }
}

#[test]
fn it_looks_like_usdc_to_anything_that_asks() {
    // The escrow and the UI both assume 7 decimals. A token that reported 6
    // would silently make every amount ten times too small.
    let f = Fixture::new();
    assert_eq!(f.token.decimals(), 7);
    assert_eq!(f.token.symbol(), soroban_sdk::String::from_str(&f.env, "USDC"));
    // Read out of the host so the assertion is about the characters, not about
    // how `String` happens to render in a debug format.
    let name = f.token.name();
    let mut bytes = [0u8; 64];
    name.copy_into_slice(&mut bytes[..name.len() as usize]);
    let name = core::str::from_utf8(&bytes[..name.len() as usize]).unwrap();
    assert!(name.contains("Demo"), "the name must not read as real USDC: {}", name);
}

#[test]
fn an_address_that_never_received_anything_has_a_balance_of_zero() {
    let f = Fixture::new();
    assert_eq!(f.token.balance(&f.alice), 0);
}

#[test]
fn minting_credits_exactly_what_was_asked_for() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &(5 * ONE));
    f.client.mint(&f.alice, &(2 * ONE));
    assert_eq!(f.token.balance(&f.alice), 7 * ONE);
}

#[test]
fn only_the_admin_can_mint() {
    // The faucet is admin-gated on purpose: a public demo with an open mint is
    // a demo somebody mints a trillion of for fun.
    let f = Fixture::new();
    f.env.set_auths(&[]);

    let err = f
        .client
        .try_mint(&f.alice, &ONE)
        .expect_err("an unauthorized mint was accepted");
    assert_ne!(err, rejected(Error::NegativeAmount));
    assert_eq!(f.token.balance(&f.alice), 0);
}

#[test]
fn transfer_moves_the_balance_and_nothing_else() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &(10 * ONE));

    f.token.transfer(&f.alice, &f.bob, &(3 * ONE));

    assert_eq!(f.token.balance(&f.alice), 7 * ONE);
    assert_eq!(f.token.balance(&f.bob), 3 * ONE);
}

#[test]
fn a_transfer_larger_than_the_balance_moves_nothing() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &ONE);

    assert_eq!(
        f.token.try_transfer(&f.alice, &f.bob, &(2 * ONE)).unwrap_err(),
        rejected(Error::InsufficientBalance),
    );
    assert_eq!(f.token.balance(&f.alice), ONE, "the failed transfer debited anyway");
    assert_eq!(f.token.balance(&f.bob), 0);
}

#[test]
fn negative_amounts_are_refused_everywhere_they_could_be_used_to_steal() {
    // Without this check, `transfer(-1)` credits the recipient and refunds the
    // sender: the arithmetic works, which is exactly the problem.
    let f = Fixture::new();
    f.client.mint(&f.alice, &ONE);

    assert_eq!(f.client.try_mint(&f.alice, &-ONE).unwrap_err(), rejected(Error::NegativeAmount));
    assert_eq!(
        f.token.try_transfer(&f.alice, &f.bob, &-ONE).unwrap_err(),
        rejected(Error::NegativeAmount),
    );
    assert_eq!(f.token.try_burn(&f.alice, &-ONE).unwrap_err(), rejected(Error::NegativeAmount));
    assert_eq!(f.token.balance(&f.alice), ONE);
    assert_eq!(f.token.balance(&f.bob), 0);
}

#[test]
fn burning_destroys_supply_rather_than_moving_it() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &(4 * ONE));

    f.token.burn(&f.alice, &(ONE));

    assert_eq!(f.token.balance(&f.alice), 3 * ONE);
    assert_eq!(f.token.balance(&f.admin), 0, "a burn quietly paid the admin");
}

#[test]
fn an_allowance_lets_a_spender_move_someone_elses_money_once() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &(10 * ONE));
    let expiry = f.env.ledger().sequence() + 100;

    f.token.approve(&f.alice, &f.bob, &(4 * ONE), &expiry);
    assert_eq!(f.token.allowance(&f.alice, &f.bob), 4 * ONE);

    f.token.transfer_from(&f.bob, &f.alice, &f.bob, &(3 * ONE));

    assert_eq!(f.token.balance(&f.alice), 7 * ONE);
    assert_eq!(f.token.balance(&f.bob), 3 * ONE);
    assert_eq!(f.token.allowance(&f.alice, &f.bob), ONE, "the allowance was not drawn down");
}

#[test]
fn spending_more_than_the_allowance_fails_even_with_the_balance_behind_it() {
    let f = Fixture::new();
    f.client.mint(&f.alice, &(10 * ONE));
    f.token.approve(&f.alice, &f.bob, &ONE, &(f.env.ledger().sequence() + 100));

    assert_eq!(
        f.token
            .try_transfer_from(&f.bob, &f.alice, &f.bob, &(2 * ONE))
            .unwrap_err(),
        rejected(Error::InsufficientAllowance),
    );
    assert_eq!(f.token.balance(&f.alice), 10 * ONE);
}

#[test]
fn an_allowance_is_worthless_once_its_expiry_ledger_passes() {
    // The bug this is about: the entry can still be in storage after the
    // ledger it was good for. Reading it back as its old value would let a
    // stale approval be spent.
    let f = Fixture::new();
    f.client.mint(&f.alice, &(10 * ONE));
    let expiry = f.env.ledger().sequence() + 10;
    f.token.approve(&f.alice, &f.bob, &(5 * ONE), &expiry);

    f.env.ledger().set_sequence_number(expiry + 1);

    assert_eq!(f.token.allowance(&f.alice, &f.bob), 0);
    assert_eq!(
        f.token
            .try_transfer_from(&f.bob, &f.alice, &f.bob, &ONE)
            .unwrap_err(),
        rejected(Error::InsufficientAllowance),
    );
}

#[test]
fn an_allowance_cannot_be_granted_into_the_past() {
    let f = Fixture::new();
    f.env.ledger().set_sequence_number(1_000);

    assert_eq!(
        f.token.try_approve(&f.alice, &f.bob, &ONE, &999).unwrap_err(),
        rejected(Error::ExpirationInPast),
    );
}

#[test]
fn revoking_an_allowance_works_regardless_of_the_expiry_given() {
    // Revocation must never be the thing that fails validation, or an approval
    // granted by mistake could not be taken back.
    let f = Fixture::new();
    f.env.ledger().set_sequence_number(1_000);
    f.token.approve(&f.alice, &f.bob, &ONE, &2_000);

    f.token.approve(&f.alice, &f.bob, &0, &0);

    assert_eq!(f.token.allowance(&f.alice, &f.bob), 0);
}

#[test]
fn handing_over_admin_moves_the_mint_with_it() {
    // `mock_all_auths` signs for whoever is asked, so it cannot tell these two
    // apart. Naming the signer is the only way to prove the contract now asks
    // for the new admin and no longer accepts the old one.
    let f = Fixture::new();
    let new_admin = Address::generate(&f.env);
    f.client.set_admin(&new_admin);
    assert_eq!(f.client.admin(), new_admin);

    let mint = |signer: &Address| {
        f.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &f.addr,
                fn_name: "mint",
                args: (f.alice.clone(), ONE).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        f.client.try_mint(&f.alice, &ONE)
    };

    assert!(mint(&f.admin).is_err(), "the previous admin can still mint");
    assert!(mint(&new_admin).is_ok(), "the new admin cannot mint");
    assert_eq!(f.token.balance(&f.alice), ONE);
}

#[test]
fn the_escrow_can_hold_it_like_any_other_sep41_token() {
    // The only property the escrow actually needs: `token::Client` works
    // against this contract, including a transfer out of a contract address.
    let f = Fixture::new();
    let holder = Address::generate(&f.env);
    f.client.mint(&f.alice, &(10 * ONE));

    f.token.transfer(&f.alice, &holder, &(6 * ONE));
    f.token.transfer(&holder, &f.bob, &(6 * ONE));

    assert_eq!(f.token.balance(&holder), 0);
    assert_eq!(f.token.balance(&f.bob), 6 * ONE);
}
