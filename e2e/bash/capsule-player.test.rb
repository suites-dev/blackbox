# frozen_string_literal: true

require 'minitest/autorun'
require 'psych'
require 'shellwords'
require_relative 'capsule-player-support'

class CapsulePlayerTest < Minitest::Test
  def test_custom_fixture_token_reaches_execution_but_not_display
    story_path = File.join(__dir__, 'capsule-demo.yaml')
    story = Psych.safe_load(
      File.read(story_path),
      permitted_classes: [],
      aliases: false
    )
    token = 'non-default-fixture-token'
    values = CapsulePlayerSupport.initial_values(
      'FIXTURE_CONTROL_TOKEN' => token
    )
    values['SESSION_ID'] = 'steady-river-ada-123456789012'
    values['ENTRYPOINT_URL'] = 'http://127.0.0.1:43180'

    start_argv = command_argv(story, 'start', values)
    reset_argv = command_argv(story, 'fixture-reset', values)
    assert_includes start_argv, "FIXTURE_CONTROL_TOKEN=#{token}"
    assert_includes reset_argv, "Authorization: Bearer #{token}"

    [start_argv, reset_argv].each do |argv|
      execution_argv = argv.dup
      displayed = CapsulePlayerSupport.display_command(
        argv,
        sensitive_values: [token]
      )
      assert_equal execution_argv, argv
      refute_includes displayed, token
      assert_includes displayed, CapsulePlayerSupport::REDACTED
    end
  end

  private

  def command_argv(story, step_id, values)
    step = story.fetch('steps').find do |candidate|
      candidate.fetch('id') == step_id
    end
    command = CapsulePlayerSupport.interpolate(step.fetch('command'), values)
    ['blackbox', *Shellwords.split(command)]
  end
end
