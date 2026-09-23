#!/usr/bin/env ruby

# Small dependency-free presenter for capsule-demo.yaml. Ruby's standard
# Psych parser keeps the storyboard readable without adding a runtime package.

require 'open3'
require 'json'
require 'fileutils'
require 'psych'
require 'shellwords'
require 'uri'

root = File.expand_path('../..', __dir__)
project_directory = File.join(root, 'e2e')
story_path = File.join(__dir__, 'capsule-demo.yaml')
options = ARGV.each_with_object({}) { |arg, result| result[arg] = true }
color = $stdout.tty? && !options['--no-color'] && ENV['NO_COLOR'].nil?
reset = color ? "\e[0m" : ''
blue = color ? "\e[34m" : ''
cyan = color ? "\e[36m" : ''
green = color ? "\e[32m" : ''
yellow = color ? "\e[33m" : ''
dim = color ? "\e[2m" : ''

def interpolate(command, values)
  command.gsub(/\$\{([A-Z_]+)\}/) { values.fetch(Regexp.last_match(1), "") }
end

def stop_report_viewer(server)
  return unless server
  output, wait_thread, owned = server
  return unless owned
  begin
    Process.kill('INT', wait_thread.pid) if wait_thread.alive?
  rescue Errno::ESRCH
    # It already exited; the exit status still determines success.
  end
  output.close
  raise 'Report server did not stop cleanly' unless wait_thread.value.success?
end

def display_command(argv)
  lines = []
  argv.each do |arg|
    if arg.start_with?('--') && !lines.empty?
      lines << "        #{Shellwords.escape(arg)}"
    elsif lines.empty?
      lines << Shellwords.escape(arg)
    else
      lines[-1] += " #{Shellwords.escape(arg)}"
    end
  end
  lines.join(" \\\n")
end

story = Psych.safe_load(File.read(story_path), permitted_classes: [], aliases: false)
values = { 'SESSION_ID' => '', 'ENTRYPOINT_URL' => '', 'REPORT_ROOT' => '' }
session_stopped = false
report_server = nil

begin
  puts "#{blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━#{reset}"
  puts "#{cyan}[blackbox]#{reset} #{yellow}#{story.fetch('title')}#{reset}"
  puts "#{dim}Storyboard: #{story_path}#{reset}"

  story.fetch('steps').each_with_index do |step, index|
    kind = step.fetch('kind')
    command = interpolate(step.fetch('command'), values)
    command = "#{File.join(root, command)}" if kind == 'shell'
    executable = kind == 'shell' ? command : "node #{File.join(root, 'packages/cli/bin/run.js')} #{command}"
    puts "\n#{blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━#{reset}"
    puts "#{cyan}[#{index + 1}/#{story.fetch('steps').length}]#{reset} #{yellow}#{step.fetch('explanation')}#{reset}"
    puts "#{dim}$ #{display_command(kind == 'shell' ? Shellwords.split(command) : ['blackbox', *Shellwords.split(command)])}#{reset}"
    unless options['--no-pause']
      $stdout.write('Press Enter to run it... ')
      STDIN.gets
    end

    if kind == 'serve'
      stop_report_viewer(report_server)
      report_server = nil
      input, output, wait_thread = Open3.popen2e(*Shellwords.split(executable), chdir: project_directory)
      report_server = [output, wait_thread, true]
      input.close
      server_url = nil
      ownership = nil
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

    input, output, wait_thread = Open3.popen2(*Shellwords.split(executable), chdir: project_directory, err: STDERR)
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
    system("node", File.join(root, 'packages/cli/bin/run.js'), 'capsule', 'stop', '--session', values['SESSION_ID'], '--json', chdir: project_directory)
  end
end
