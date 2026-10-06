@system:subscription-system @sandbox:default
@requirement:REQ-100
Feature: Subscription intake
  A known user can hold one active subscription. Full-path users are approved,
  charged and ordered; local-only users are activated without external effects.

  Background:
    Given the state at "/fixture/state" as "fixture-control" equals:
      """json
      {"fraudAudit": [], "payment": {"paymentIntents": [], "refunds": []},
       "queueDepth": 0, "redis": {}, "subscriptions": []}
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
         "subscription": {"id": "subscription_alice", "status": "active"},
         "paymentIntentId": "pi_alice1", "orderId": "order_alice"}
        """
      And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:
        """json
        [{"id": "subscription_alice", "userId": "alice", "tier": "pro", "status": "active",
          "paymentIntentId": "pi_alice1", "orderId": "order_alice"}]
        """
      And the state at "/fixture/state" as "fixture-control" has "/queueDepth" equal to:
        """json
        1
        """

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

    Scenario: a local-only user activates without payment or ordering
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "dora", "paymentMethodId": "pm_dora_unused"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 201
      And the state at "/fixture/state" as "fixture-control" has "/payment/paymentIntents" equal to:
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
      And the state at "/fixture/state" as "fixture-control" has 1 item at "/payment/paymentIntents"

    @requirement:REQ-120 @requirement:REQ-121
    Scenario: concurrent requests create exactly one subscription
      When the client sends these requests concurrently:
        | method | path           | json                                               |
        | POST   | /subscriptions | {"userId": "bob", "paymentMethodId": "pm_bob_one"} |
        | POST   | /subscriptions | {"userId": "bob", "paymentMethodId": "pm_bob_two"} |
      Then the flow is sealed by the terminal responses
      And the response statuses are "201, 409"
      And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
