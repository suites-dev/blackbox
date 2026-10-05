@system:subscription-system @sandbox:default
@requirement:REQ-100
Feature: Feature-level Background
  The Background runs inside every attempt, before each scenario's own steps.
  Description lines are documentation and are never executed.

  Background:
    Given the account "alice" exists
    And the state at "/fixture/state" equals:
      """json
      {"subscriptions": []}
      """

  Scenario: a direct request
    When the client sends GET "/health"
    Then the response status is 200

  @requirement:REQ-101
  Scenario: a second scenario shares the Background
    When the client sends GET "/ready"
    Then the response status is 204
