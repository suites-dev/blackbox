@system:subscription-system @sandbox:default
Feature: Doc strings and data tables are passed as plain data

  Scenario: concurrent requests
    When the client sends these requests concurrently:
      | method | path           | json                |
      | POST   | /subscriptions | {"userId": "bob"}   |
      | POST   | /subscriptions | {"userId": "bob"}   |
    Then the flow is sealed by the terminal responses
    And the state at "/fixture/state" equals:
      """
      line one
        indented "quoted" line
      """
