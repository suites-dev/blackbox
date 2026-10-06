@system:payment-mock @sandbox:bare
Feature: A subsystem is selected through @system and its kind is read from the catalog

  Scenario: the subsystem answers
    When the client sends GET "/v1/health"
    Then the response status is 200
