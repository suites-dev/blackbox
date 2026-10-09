const feature = `
@subsystem:orders @sandbox:default @sync
Feature: Order pricing
  Background: A product is available
    Given client "api" has sent POST "/products" with JSON and received 201:
      """json
      { "sku": "keyboard", "price": 100, "stock": 3 }
      """

  Rule: Valid quantities produce a quote
    Scenario: Quote two keyboards
      When client "api" sends POST "/quotes" with JSON:
        """json
        { "sku": "keyboard", "quantity": 2 }
        """
      Then the response status is 200
      * the response JSON contains these fields:
        | field    | json       |
        | sku      | "keyboard" |
        | quantity | 2          |
        | total    | 200        |

  @validation
  Rule: Quantities must be positive
    Background: Only one item is available
      Given client "api" has sent PATCH "/products/keyboard" with JSON and received 200:
        """json
        { "stock": 1 }
        """

    Scenario Outline: Reject quantity <quantity>
      When client "api" sends POST "/quotes" with JSON:
        """json
        { "sku": "keyboard", "quantity": <quantity> }
        """
      Then the response status is <status>
      But the response JSON contains:
        """json
        { "code": "<code>" }
        """

      Examples: Rejected quantities
        | quantity | status | code               |
        | 0        | 422    | INVALID_QUANTITY   |
        | 2        | 409    | INSUFFICIENT_STOCK |
`;

export default feature;
