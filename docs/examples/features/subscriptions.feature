@system:subscription-system @sandbox:default
@requirement:REQ-101
Feature: Subscriptions
  Scenario: Alice receives one active subscription
    Given the state at "/fixture/state" as "fixture-control" has 0 items at "/subscriptions"
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId":"alice","paymentMethodId":"pm_alice_primary"}
      """
    Then the response status is 201
    And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
    And the state at "/fixture/state" as "fixture-control" has "/subscriptions/0/userId" equal to:
      """json
      "alice"
      """
    And the state at "/fixture/state" as "fixture-control" has "/subscriptions/0/status" equal to:
      """json
      "active"
      """
