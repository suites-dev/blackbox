@system:subscription-system @sandbox:default
Feature: Barrier deadlines and named credentials
  Deadlines written in the feature are runner policy, so the compile manifest
  records every one a scenario runs, Background steps included.

  Background:
    Given the flow is sealed within 3 seconds

  Scenario: a scenario deadline after the Background one
    When the client sends GET "/orders"
    Then the flow is sealed within 10 seconds
    And the state at "/fixture/state" as "fixture-control" has 1 item

  Rule: a Rule-level Background deadline

    Background:
      Given the flow is sealed within 1 second

    Scenario: a Rule scenario runs both Background deadlines
      When the client sends GET "/orders"
      Then the response status is 200
