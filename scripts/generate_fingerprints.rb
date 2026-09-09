#!/usr/bin/env ruby
# scripts/generate_fingerprints.rb
#
# Generates public/data/fingerprints.json with the first notes of each score.
# Re-run after adding or removing scores from the library:
#   ruby scripts/generate_fingerprints.rb

# UTF-8 whatever the locale says, once per process — see the Rakefile.
Encoding.default_external = Encoding::UTF_8 unless Encoding.default_external == Encoding::UTF_8

require 'rexml/document'
require 'json'
require 'tmpdir'
require 'open3'

SCORES_JSON = File.join(__dir__, '..', 'public', 'data', 'scores.json')
SCORES_DIR  = File.join(__dir__, '..', 'public', 'scores')
OUTPUT_FILE = File.join(__dir__, '..', 'public', 'data', 'fingerprints.json')
NOTE_COUNT  = 20

STEP_SEMITONES = { 'C' => 0, 'D' => 2, 'E' => 4, 'F' => 5, 'G' => 7, 'A' => 9, 'B' => 11 }.freeze

def pitch_to_midi(step, alter, octave)
  12 * (octave.to_i + 1) + STEP_SEMITONES[step] + alter.to_i
end

def read_xml_from_mxl(path)
  Dir.mktmpdir do |tmpdir|
    _, err, status = Open3.capture3('unzip', '-q', path, '-d', tmpdir)
    unless status.success?
      warn "  unzip failed: #{err.chomp}"
      return nil
    end

    container_path = File.join(tmpdir, 'META-INF', 'container.xml')
    if File.exist?(container_path)
      container = REXML::Document.new(File.read(container_path))
      rootfile = REXML::XPath.first(container, '//rootfile')&.attributes['full-path']
      if rootfile
        xml_path = File.join(tmpdir, rootfile)
        return File.read(xml_path) if File.exist?(xml_path)
      end
    end

    # Fallback: first XML that isn't container.xml
    xml_files = Dir.glob(File.join(tmpdir, '**', '*.xml'))
      .reject { |f| f.end_with?('container.xml') }
    xml_files.empty? ? nil : File.read(xml_files.first)
  end
rescue => e
  warn "  read_xml_from_mxl error: #{e.message}"
  nil
end

def extract_notes(xml_content)
  doc = REXML::Document.new(xml_content)
  notes = []

  part = REXML::XPath.first(doc.root, './/part')
  return notes unless part

  REXML::XPath.each(part, 'measure') do |measure|
    # Voice 1 (the melody / right hand) can be engraved on the lower staff —
    # e.g. when both hands play in the bass register (Hanon) or the melody
    # dips below the treble staff (The Entertainer). Per measure, follow
    # voice 1 onto the topmost staff it occupies.
    by_staff = Hash.new { |h, k| h[k] = [] }

    measure.elements.each('note') do |note|
      next if note.elements['rest']
      next if note.elements['grace']
      next if note.elements['chord']

      voice = note.elements['voice']&.text&.to_i || 1
      next if voice != 1

      has_stop  = REXML::XPath.first(note, "tie[@type='stop']")
      has_start = REXML::XPath.first(note, "tie[@type='start']")
      next if has_stop && !has_start

      pitch = note.elements['pitch']
      next unless pitch

      step   = pitch.elements['step']&.text
      alter  = pitch.elements['alter']&.text&.to_i || 0
      octave = pitch.elements['octave']&.text
      next unless step && octave && STEP_SEMITONES.key?(step)

      staff = note.elements['staff']&.text&.to_i || 1
      by_staff[staff] << pitch_to_midi(step, alter, octave)
    end

    next if by_staff.empty?

    notes.concat(by_staff[by_staff.keys.min])
    break if notes.length >= NOTE_COUNT
  end

  notes.first(NOTE_COUNT)
rescue REXML::ParseException => e
  warn "  XML parse error: #{e.message.lines.first&.chomp}"
  []
end

# Main
data = JSON.parse(File.read(SCORES_JSON))
fingerprints = []
errors = []

# Collections ("parts" instead of "file") get one fingerprint per part, so
# playing the opening of an exercise opens that exercise directly.
entries = data['scores'].flat_map do |score|
  next score unless score['parts']
  score['parts'].map do |part|
    { 'title' => "#{score['title']} — #{part['title']}", 'composer' => score['composer'], 'file' => part['file'] }
  end
end

entries.each do |score|
  file_path = File.join(SCORES_DIR, score['file'])

  unless File.exist?(file_path)
    errors << "File not found: #{score['file']}"
    next
  end

  xml = score['file'].end_with?('.mxl') ? read_xml_from_mxl(file_path) : File.read(file_path)

  if xml.nil?
    errors << "Could not read: #{score['file']}"
    next
  end

  notes = extract_notes(xml)

  if notes.length < 3
    errors << "Too few notes (#{notes.length}): #{score['file']}"
    next
  end

  fingerprints << {
    'file'     => score['file'],
    'title'    => score['title'],
    'composer' => score['composer'],
    'notes'    => notes,
  }

  puts "#{score['title'].ljust(55)} #{notes.inspect}"
end

unless errors.empty?
  warn "\n#{errors.length} warning(s):"
  errors.each { |e| warn "  ! #{e}" }
end

lines = fingerprints.map { |fp| JSON.generate(fp) }
File.write(OUTPUT_FILE, "{\n  \"fingerprints\": [\n    #{lines.join(",\n    ")}\n  ]\n}\n")
puts "\nGenerated #{fingerprints.length}/#{entries.length} fingerprints → #{OUTPUT_FILE}"
