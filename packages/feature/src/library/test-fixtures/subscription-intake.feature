@system:subscription-system @sandbox:default
@requirement:REQ-100
Feature: Subscription intake
  The worked example of the design report (section 6.1) without its effects
  rows, written against the qualification stub's state document.

  Background:
    Given the state at "/fixture/state" as "fixture-control" equals:
      """json
      {"subscriptions": [], "orders": []}
      """

  @requirement:REQ-101
  Rule: full-path subscriptions settle every required effect

    @requirement:REQ-110
    Scenario: an eligible user receives an active subscription
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "alice", "paymentMethodId": "pm_alice_primary"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 201
      And the response JSON equals:
        """json
        {"userId": "alice", "tier": "pro",
         "subscription": {"id": "subscription_alice", "status": "active"}}
        """
      And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:
        """json
        [{"id": "subscription_alice", "userId": "alice", "tier": "pro", "status": "active"}]
        """
      And the flow is sealed within 5 seconds when the state at "/fixture/state" as "fixture-control" has 1 item at "/orders"

  @requirement:REQ-102
  Rule: invalid subscription attempts have no side effects

    Scenario Outline: an unknown user is rejected without side effects
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "<user>", "paymentMethodId": "<method>"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 404
      And the response JSON equals:
        """json
        {"outcome": "unknown-user", "userId": "<user>"}
        """
      And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:
        """json
        []
        """

      Examples:
        | user       | method       |
        | ghost-user | pm_ghost     |
        | mallory    | pm_mallory_1 |

  Rule: local-only subscriptions avoid external service effects

    Scenario: a local-only user activates without ordering
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "dora", "paymentMethodId": "pm_dora_unused"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 201
      And the state at "/fixture/state" as "fixture-control" has "/orders" equal to:
        """json
        []
        """

  Rule: a user can hold only one subscription

    Scenario: a repeated request does not repeat downstream effects
      Given the client has sent POST "/subscriptions" with JSON and received 201:
        """json
        {"userId": "carol", "paymentMethodId": "pm_carol_primary"}
        """
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "carol", "paymentMethodId": "pm_carol_secondary"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 409
      And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"

    @requirement:REQ-120 @requirement:REQ-121
    Scenario: concurrent requests create exactly one subscription
      When the client sends these requests concurrently:
        | method | path           | json                                               |
        | POST   | /subscriptions | {"userId": "bob", "paymentMethodId": "pm_bob_one"} |
        | POST   | /subscriptions | {"userId": "bob", "paymentMethodId": "pm_bob_two"} |
      Then the flow is sealed by the terminal responses
      And the response statuses are "201, 409"
      And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
