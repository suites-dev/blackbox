#!/usr/bin/env ruby

# Small dependency-free presenter for capsule-demo.yaml. Ruby's standard
# Psych parser keeps the storyboard readable without adding a runtime package.

require 'open3'
require 'json'
require 'fileutils'
require 'psych'
require 'uri'
require_relative 'capsule-player-support'

root = File.expand_path('../..', __dir__)
project_directory = File.join(root, 'e2e')
story_path = File.join(__dir__, 'capsule-demo.yaml')
blackbox_bin = ENV.fetch('BLACKBOX_BIN')
options = ARGV.each_with_object({}) { |arg, result| result[arg] = true }
color = $stdout.tty? && !options['--no-color'] && ENV['NO_COLOR'].nil?
reset = color ? "\e[0m" : ''
blue = color ? "\e[34m" : ''
cyan = color ? "\e[36m" : ''
green = color ? "\e[32m" : ''
yellow = color ? "\e[33m" : ''
dim = color ? "\e[2m" : ''

def stop_report_viewer(server)
  return unless server
  output, wait_thread, owned = server
  return unless owned
  begin
    Process.kill('INT', wait_thread.pid) if wait_thread.alive?
  rescue Errno::ESRCH
    # It already exited; the exit status still determines success.
  end
  # Drain the viewer's output until it exits, then close the pipe. Closing the
  # pipe first makes the exiting viewer fail (Node exits 13 on the broken pipe).
  output.read
  status = wait_thread.value
  output.close
  raise "Report server did not stop cleanly (#{status})" unless status.success?
end

story = Psych.safe_load(File.read(story_path), permitted_classes: [], aliases: false)
values = CapsulePlayerSupport.initial_values(ENV)
session_stopped = false
report_server = nil

begin
  puts "#{blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━#{reset}"
  puts "#{cyan}[blackbox]#{reset} #{yellow}#{story.fetch('title')}#{reset}"
  puts "#{dim}Storyboard: #{story_path}#{reset}"
  # No reset here: the consumer preparation, which must run right before the
  # player, already resets demo outputs and then installs the drivers. A second
  # reset would delete that driver installation.

  story.fetch('steps').each_with_index do |step, index|
    kind = step.fetch('kind')
    arguments = CapsulePlayerSupport.command_arguments(
      step.fetch('command'),
      values
    )
    # `capsule report serve` opens no browser unless asked; CI never asks.
    arguments += ['--open'] if kind == 'serve' && !options['--no-browser']
    executable = if kind == 'shell'
                   [File.join(root, arguments.fetch(0)), *arguments.drop(1)]
                 else
                   [blackbox_bin, *arguments]
                 end
    puts "\n#{blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━#{reset}"
    puts "#{cyan}[#{index + 1}/#{story.fetch('steps').length}]#{reset} #{yellow}#{step.fetch('explanation')}#{reset}"
    displayed_argv = if kind == 'shell'
                       executable
                     else
                       ['blackbox', *arguments]
                     end
    displayed_command = CapsulePlayerSupport.display_command(
      displayed_argv,
      sensitive_values: [values.fetch('FIXTURE_CONTROL_TOKEN')]
    )
    puts "#{dim}$ #{displayed_command}#{reset}"
    unless options['--no-pause']
      $stdout.write('Press Enter to run it... ')
      STDIN.gets
    end

    if kind == 'serve'
      stop_report_viewer(report_server)
      report_server = nil
      input, output, wait_thread = Open3.popen2e(*executable, chdir: project_directory)
      report_server = [output, wait_thread, true]
      input.close
      server_url = nil
      ownership = nil
      # `capsule report serve` announces `Blackbox reports: <url>`, then
      # `Viewer ownership: started` or `Viewer ownership: reused` (on stderr,
      # merged here).
      while (line = output.gets)
        print line
        server_url = line.sub(/^Blackbox reports: /, '').strip if line.start_with?('Blackbox reports: ')
        ownership = line.sub(/^Viewer ownership: /, '').strip if line.start_with?('Viewer ownership: ')
        break if server_url && ownership
      end
      abort 'Report server did not announce a URL' unless server_url
      if ownership == 'reused'
        raise 'Reused report viewer exited unexpectedly' unless wait_thread.value.success?
        output.close
        report_server = nil
      elsif ownership != 'started'
        raise "Invalid report viewer ownership: #{ownership}"
      end
      system('curl', '--fail', '--silent', '--show-error', URI.join(server_url, '/api/reports').to_s) || abort('Report registry request failed')
      puts "#{green}✓ flight control remains available at #{server_url}#{reset}"
      next
    end

    input, output, wait_thread = Open3.popen2(*executable, chdir: project_directory, err: STDERR)
    input.close
    stdout = output.read
    output.close
    status = wait_thread.value
    print stdout
    abort "Step #{step.fetch('id')} failed with #{status.exitstatus}" unless status.success?

    if step.fetch('id') == 'start'
      payload = JSON.parse(stdout)
      values['SESSION_ID'] = payload.fetch('sessionId')
      values['ENTRYPOINT_URL'] = payload.fetch('entrypoint').fetch('url')
      values['REPORT_ROOT'] = File.join(root, 'e2e', '.blackbox', 'reports', "capsule-#{values['SESSION_ID']}")
      FileUtils.mkdir_p(values['REPORT_ROOT'])
      puts "#{green}Session retained: #{values['SESSION_ID']}#{reset}"
    elsif step.fetch('id') == 'http-driver'
      execution = JSON.parse(stdout)
      unless execution.fetch('kind') == 'capsule-exec-completed'
        raise 'The HTTP driver execution did not complete'
      end
      values['DRIVER_ACTIVITY_ID'] = execution.fetch('activityId')
    elsif step.fetch('id') == 'observations-activity'
      observation = JSON.parse(stdout)
      values['TRACE_ID'] = observation.fetch('traceIds').fetch(0)
    elsif step.fetch('id') == 'stop'
      session_stopped = true
    end
    puts "#{green}✓ completed#{reset}"
  end
  unless options['--no-pause']
    $stdout.write('Experiment stopped; its history is still available. Press Enter to close flight control... ')
    STDIN.gets
  end
ensure
  begin
    stop_report_viewer(report_server)
  rescue StandardError => error
    warn error.message
  end
  if values['SESSION_ID'] != '' && !session_stopped
    system(blackbox_bin, 'capsule', 'down', values['SESSION_ID'], '--json', chdir: project_directory)
  end
end
