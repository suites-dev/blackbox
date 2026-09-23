@flow:concurrency-carol
Feature: Same-user subscribe concurrency
  Scenario: serializes concurrent subscribe calls for one user into one creation and one duplicate rejection
    When POST /subscriptions is sent for carol twice in parallel
    Then exactly one request creates with 201 and one is rejected with 409, in either order
    And exactly one fraud audit, one payment intent, one queue message, and one subscription exist
