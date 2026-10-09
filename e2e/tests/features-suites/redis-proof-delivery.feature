@system:subscription-system @sandbox:default @async
Feature: Deliver queued proof requests
  As an operator of the subscription system
  I want proof requests placed on the queue to reach the public API
  So that each submitted proof is acknowledged

  Background: An empty proof queue
    Given the proof queue is empty

  Rule: Queued proofs are acknowledged
    Scenario: Deliver one proof
      When I queue proof "proof-1001"
      Then within 30 seconds the public API accepts proof "proof-1001"
      And the proof queue is empty

    Scenario: Deliver several proofs
      When I queue these proofs:
        | proofId    |
        | proof-1002 |
        | proof-1003 |
      Then within 30 seconds the public API accepts each proof:
        | proofId    |
        | proof-1002 |
        | proof-1003 |
      And the proof queue is empty
