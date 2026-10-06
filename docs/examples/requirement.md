# REQ-101: Create a subscription

Alice is an eligible customer with no active subscription. When she subscribes using a valid payment method, the response is HTTP 201 and exactly one subscription is retained for Alice with status `active`.

## Fixture conditions

The selected system seeds Alice and begins with no subscriptions. `/fixture/state` is an authenticated inspection endpoint that reads the subscription fixture state. The subscription write completes before the API returns its response.

## Scope

This example checks response and retained state. It does not claim payment delivery, queue consumption, or full-system correctness. Those behaviors need additional accepted scenarios and suitable evidence.
