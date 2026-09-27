# frozen_string_literal: true

require 'shellwords'

module CapsulePlayerSupport
  REDACTED = '<redacted>'

  def self.initial_values(environment)
    {
      'SESSION_ID' => '',
      'ENTRYPOINT_URL' => '',
      'FIXTURE_CONTROL_TOKEN' => environment.fetch(
        'FIXTURE_CONTROL_TOKEN',
        'capsule-e2e-token'
      ),
      'REPORT_ROOT' => '',
      'DRIVER_ACTIVITY_ID' => '',
      'TRACE_ID' => ''
    }
  end

  def self.interpolate(command, values)
    command.gsub(/\$\{([A-Z_]+)\}/) do
      values.fetch(Regexp.last_match(1), '')
    end
  end

  def self.display_command(argv, sensitive_values: [])
    secrets = sensitive_values.reject(&:empty?)
    safe_argv = argv.map do |argument|
      secrets.reduce(argument.dup) do |safe_argument, secret|
        safe_argument.gsub(secret, REDACTED)
      end
    end
    lines = []
    safe_argv.each do |argument|
      if argument.start_with?('--') && !lines.empty?
        lines << "        #{escape_for_display(argument)}"
      elsif lines.empty?
        lines << escape_for_display(argument)
      else
        lines[-1] += " #{escape_for_display(argument)}"
      end
    end
    lines.join(" \\\n")
  end

  def self.escape_for_display(argument)
    Shellwords.escape(argument).gsub(Shellwords.escape(REDACTED), REDACTED)
  end
  private_class_method :escape_for_display
end
