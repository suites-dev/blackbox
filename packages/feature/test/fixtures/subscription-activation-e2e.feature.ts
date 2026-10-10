const feature = `
@system:subscription-system @sandbox:default @sync
Feature: Subscription activation
  Background: The subscription system starts fresh
    Given client "api" has sent POST "/fixture/reset" with JSON and received 200:
      """json
      { "profile": "fresh" }
      """

  Rule: Full-path subscriptions settle their downstream state before returning
    Scenario: Alice activates a subscription through the full path
      When client "api" sends POST "/subscriptions" with JSON:
        """json
        { "userId": "alice", "paymentMethodId": "pm_alice_primary" }
        """
      Then the response status is 201
      And the response JSON contains these fields:
        | field           | json                                               |
        | userId          | "alice"                                            |
        | tier            | "pro"                                              |
        | subscription    | { "id": "subscription_alice", "status": "active" } |
        | paymentIntentId | "pi_alice1"                                        |
        | orderId         | "order_alice"                                      |
      And client "api" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        {
          "fraudAudit": [{ "decision": "approved", "hintProfile": "long", "id": "1", "userId": "alice" }],
          "payment": {
            "paymentIntents": [{ "id": "pi_alice1", "paymentMethodId": "pm_alice_primary", "status": "succeeded", "userId": "alice" }],
            "refunds": []
          },
          "queueDepth": 1,
          "redis": { "hint:long:alice": "1", "user:alice:tier": "pro" },
          "subscriptions": [{ "id": "subscription_alice", "orderId": "order_alice", "paymentIntentId": "pi_alice1", "status": "active", "tier": "pro", "userId": "alice" }]
        }
        """

  @local-only
  Rule: Local-only subscriptions retain no payment or order state
    Scenario Outline: Activate local-only user <userId>
      When client "api" sends POST "/subscriptions" with JSON:
        """json
        { "userId": "<userId>", "paymentMethodId": "pm_<userId>_unused" }
        """
      Then the response status is 201
      And the response JSON contains:
        """json
        {
          "userId": "<userId>",
          "tier": "pro",
          "subscription": { "id": "subscription_<userId>", "status": "active" },
          "paymentIntentId": null,
          "orderId": null
        }
        """
      And client "api" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        {
          "fraudAudit": [],
          "payment": { "paymentIntents": [], "refunds": [] },
          "queueDepth": 0,
          "redis": { "reg:<userId>": "1", "user:<userId>:tier": "pro" },
          "subscriptions": [{ "id": "subscription_<userId>", "orderId": null, "paymentIntentId": null, "status": "active", "tier": "pro", "userId": "<userId>" }]
        }
        """

      Examples: Seeded local-only users
        | userId |
        | dora   |
        | eve    |

  @validation
  Rule: Unknown users cannot create subscriptions
    Scenario: An unknown user leaves the system unchanged
      When client "api" sends POST "/subscriptions" with JSON:
        """json
        { "userId": "ghost-user", "paymentMethodId": "pm_ghost" }
        """
      Then the response status is 404
      And the response JSON contains:
        """json
        { "outcome": "unknown-user", "userId": "ghost-user" }
        """
      But client "api" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        {
          "fraudAudit": [],
          "payment": { "paymentIntents": [], "refunds": [] },
          "queueDepth": 0,
          "redis": {},
          "subscriptions": []
        }
        """

  Rule: A subscription can be created only once
    Background: Carol already has a subscription
      Given client "api" has sent POST "/subscriptions" with JSON and received 201:
        """json
        { "userId": "carol", "paymentMethodId": "pm_carol_primary" }
        """

    Scenario: A repeated request retains only the original downstream state
      When client "api" sends POST "/subscriptions" with JSON:
        """json
        { "userId": "carol", "paymentMethodId": "pm_carol_secondary" }
        """
      Then the response status is 409
      And the response JSON contains:
        """json
        { "outcome": "duplicate-subscription", "userId": "carol" }
        """
      And client "api" GET "/fixture/state" returns 200 with JSON exactly:
        """json
        {
          "fraudAudit": [{ "decision": "approved", "hintProfile": "long", "id": "1", "userId": "carol" }],
          "payment": {
            "paymentIntents": [{ "id": "pi_carol1", "paymentMethodId": "pm_carol_primary", "status": "succeeded", "userId": "carol" }],
            "refunds": []
          },
          "queueDepth": 1,
          "redis": { "hint:long:carol": "1", "user:carol:tier": "pro" },
          "subscriptions": [{ "id": "subscription_carol", "orderId": "order_carol", "paymentIntentId": "pi_carol1", "status": "active", "tier": "pro", "userId": "carol" }]
        }
        """
`;

export default feature;
