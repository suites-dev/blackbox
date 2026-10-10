const feature = `
@subsystem:escape-tests @sandbox:default @sync
Feature: Escaping \\ and quotes " safely
  Rule: Preserve authored step keywords and row identity
    Scenario Outline: Return a value for <value>
      When client "api" sends POST "/values" with JSON:
        """json
        { "value": "<value>" }
        """
      Then the response status is <status>
      And the response JSON contains these fields:
        | field | json    |
        | value | "<value>" |
      But the response JSON contains:
        """json
        { "value": "<value>" }
        """
      * client "api" has sent POST "/audit" with JSON and received 204:
        """json
        { "label": "quote and tick: \` and interpolation: \${literal}" }
        """

      Examples: First duplicate block
        | value | status |
        | same  | 200    |
        | same  | 200    |

      Examples: Second duplicate block
        | value | status |
        | same  | 200    |
`;

export default feature;
