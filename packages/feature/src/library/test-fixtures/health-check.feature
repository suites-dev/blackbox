@system:subscription-system @sandbox:default
@requirement:REQ-1
Feature: Health check
  The public API reports that it is ready to serve.

  Scenario: the public API reports ready
    When the client sends GET "/health"
    Then the response status is 200
    And the response JSON equals:
      """json
      {"status": "ready"}
      """
