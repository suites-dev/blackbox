const feature = `
@subsystem:subscription-system @sandbox:default
Feature: Subscription activation
  Rule: Local-only subscriptions retain no payment or order state
    Scenario Outline: Activate local-only user <userId>
      When client "api" sends POST "/subscriptions" with JSON:
        """json
        { "userId": "<userId>", "paymentMethodId": "pm_<userId>_unused", "state": { "reg:<userId>": "1" } }
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

      Examples: Seeded local-only users
        | userId |
        | dora   |
        | eve    |
`;

export default feature;
