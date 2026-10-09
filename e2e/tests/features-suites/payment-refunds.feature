@subsystem:payment-mock @sandbox:default @sync
Feature: Payment refunds
  Background: The payment subsystem starts fresh
    Given client "payments" has sent POST "/fixture/reset" with JSON and received 200:
      """json
      {}
      """

  @validation
  Rule: A refund must reference an existing payment
    Scenario: An unknown payment cannot be refunded
      When client "payments" sends POST "/v1/refunds" with JSON:
        """json
        { "paymentIntentId": "pi_missing1" }
        """
      Then the response status is 404
      And the response JSON contains:
        """json
        { "code": "payment-intent-not-found" }
        """
      But client "payments" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        { "paymentIntents": [], "refunds": [] }
        """

  Rule: Each payment can be refunded only once
    Background: Alice has a succeeded payment
      Given client "payments" has sent POST "/v1/payment_intents" with JSON and received 201:
        """json
        { "userId": "alice", "paymentMethodId": "pm_alice_refundable" }
        """

    Scenario: A repeated refund retains exactly one refund
      When client "payments" sends POST "/v1/refunds" with JSON:
        """json
        { "paymentIntentId": "pi_alice1" }
        """
      Then the response status is 201
      * the response JSON contains these fields:
        | field           | json        |
        | id              | "refund_1"  |
        | paymentIntentId | "pi_alice1" |
        | status          | "succeeded" |
      When client "payments" sends POST "/v1/refunds" with JSON:
        """json
        { "paymentIntentId": "pi_alice1" }
        """
      Then the response status is 409
      And the response JSON contains:
        """json
        { "code": "refund-already-exists" }
        """
      And client "payments" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        {
          "paymentIntents": [{ "id": "pi_alice1", "paymentMethodId": "pm_alice_refundable", "status": "succeeded", "userId": "alice" }],
          "refunds": [{ "id": "refund_1", "paymentIntentId": "pi_alice1", "status": "succeeded" }]
        }
        """
