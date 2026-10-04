@system:subscription-system @sandbox:default
Feature: Scenario Outline rows become separate tests

  @requirement:REQ-102
  Scenario Outline: <user> is rejected
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId": "<user>", "paymentMethodId": "<method>"}
      """
    Then the response status is <status>

    Examples: unknown users
      | user       | method       | status |
      | ghost-user | pm_ghost     | 404    |
      | mallory    | pm_mallory_1 | 404    |

    Examples: a second table
      | user | method  | status |
      | eve  | pm_eve  | 403    |
