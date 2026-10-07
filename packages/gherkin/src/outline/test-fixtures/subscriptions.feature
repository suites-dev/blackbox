@system:subscription-system @sandbox:default
@requirement:REQ-1
Feature: subscriptions

  Background:
    Given the account "alice" exists

  Scenario: a health probe answers
    When the client sends GET "/health"
    Then the response status is 200

  Rule: a repeated subscription is a conflict

    Background:
      Given the client sends POST "/subscriptions" with JSON:
        """json
        {"userId": "alice"}
        """

    @requirement:REQ-2
    Scenario Outline: <method> again answers <status>
      When the client sends <method> "/subscriptions"
      Then the response status is <status>
      And the subscription is billed once

      @requirement:REQ-3
      Examples: retried
        | method | status |
        | POST   | 409    |
        | PUT    | 405    |

  Rule: concurrent requests

    Scenario: two requests at once
      When the client sends these requests concurrently:
        | method | path           |
        | POST   | /subscriptions |
        | POST   | /subscriptions |
      Then the flow is sealed by the terminal responses
      * the response has 2 items at /subscriptions
