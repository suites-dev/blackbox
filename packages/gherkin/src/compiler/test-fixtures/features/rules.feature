@system:subscription-system @sandbox:default @requirement:REQ-100
Feature: Rules and Rule-level Backgrounds

  Background:
    Given the account "carol" exists

  Scenario: outside any Rule
    When the client sends GET "/health"
    Then the response status is 200

  @requirement:REQ-101
  Rule: full-path subscriptions

    Background:
      Given the account "alice" exists

    @requirement:REQ-110 @requirement:REQ-100
    Scenario: an eligible user subscribes
      When the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "alice"}
        """
      Then the flow is sealed by the terminal response
      And the response status is 201

  Rule: a Rule without its own Background or requirement

    Scenario: an unknown user is rejected
      When the client sends GET "/subscriptions/ghost"
      Then the response status is 404
