#!/usr/bin/env ruby
# scripts/split_hanon.rb
#
# Splits the "Le Pianiste virtuose - Première partie (1-20)" MusicXML file
# (source: http://musescore.com/james_brigham/hanon-part-1) into one .mxl
# per exercise, written to public/scores/.
#
# The source file contains the 20 exercises back to back, each starting on
# a new page (<print new-page="yes">). Splitting on those boundaries needs
# some care because MusicXML state is cumulative:
#   - <attributes> (divisions, key, time, staves, clefs) are only emitted
#     when they change, so each chunk's first measure gets a full, merged
#     copy of the running state;
#   - the tempo indication (M.M. 60-108, <sound tempo>) only exists in
#     exercise 1, so it is copied into every other exercise;
#   - measures are renumbered from 1 within each exercise.
#
# Usage:
#   ruby scripts/split_hanon.rb path/to/le-pianiste-virtuose-1-20.mxl
#
# Re-run scripts/generate_fingerprints.rb afterwards.

# UTF-8 whatever the locale says, once per process — see the Rakefile.
Encoding.default_external = Encoding::UTF_8 unless Encoding.default_external == Encoding::UTF_8

require 'rexml/document'
require 'tmpdir'
require 'fileutils'
require 'open3'

EXERCISE_COUNT = 20
OUTPUT_DIR     = File.join(__dir__, '..', 'public', 'scores')
FILE_FORMAT    = 'Hanon_Le_Pianiste_Virtuose_Ex_%02d.mxl'
TITLE_FORMAT   = 'Exercice %d'
COMPOSER       = 'Charles-Louis Hanon'
SOURCE_URL     = 'http://musescore.com/james_brigham/hanon-part-1'

# Children of <attributes> we carry across exercises, in DTD order.
TRACKED_ATTRIBUTES = %w[divisions key time staves].freeze

def read_xml(path)
  head = File.binread(path, 4)
  return File.read(path) unless head == "PK\x03\x04".b

  Dir.mktmpdir do |tmpdir|
    _, err, status = Open3.capture3('unzip', '-q', '-o', path, '-d', tmpdir)
    abort "unzip failed: #{err}" unless status.success?
    xml = Dir.glob(File.join(tmpdir, '**', '*.xml'))
      .reject { |f| f.end_with?('container.xml') }
      .max_by { |f| File.size(f) }
    abort "no MusicXML found in #{path}" unless xml
    File.read(xml)
  end
end

def write_mxl(doc, output_path)
  Dir.mktmpdir do |tmpdir|
    FileUtils.mkdir_p(File.join(tmpdir, 'META-INF'))
    File.write(File.join(tmpdir, 'META-INF', 'container.xml'), <<~XML)
      <?xml version="1.0" encoding="UTF-8"?>
      <container>
        <rootfiles>
          <rootfile full-path="score.xml"/>
        </rootfiles>
      </container>
    XML

    File.open(File.join(tmpdir, 'score.xml'), 'w') do |f|
      f.puts '<?xml version="1.0" encoding="UTF-8"?>'
      doc.write(output: f)
    end

    mxl = File.join(tmpdir, 'out.mxl')
    _, err, status = Open3.capture3('zip', '-q', '-r', '-X', mxl, 'META-INF', 'score.xml', chdir: tmpdir)
    abort "zip failed: #{err}" unless status.success?
    FileUtils.mv(mxl, output_path)
  end
end

# Running attribute state, updated measure by measure, used to rebuild a
# complete <attributes> at each exercise start.
def update_state(state, measure)
  attrs = measure.elements['attributes']
  return unless attrs

  TRACKED_ATTRIBUTES.each do |name|
    el = attrs.elements[name]
    state[name] = el.deep_clone if el
  end
  attrs.elements.each('clef') do |clef|
    state[:clefs][clef.attributes['number'] || '1'] = clef.deep_clone
  end
end

def merged_attributes(state)
  attrs = REXML::Element.new('attributes')
  TRACKED_ATTRIBUTES.each do |name|
    attrs.add_element(state[name].deep_clone) if state[name]
  end
  state[:clefs].keys.sort.each { |n| attrs.add_element(state[:clefs][n].deep_clone) }
  attrs
end

input = ARGV[0]
abort "Usage: ruby #{$PROGRAM_NAME} <hanon-1-20.mxl>" unless input && File.exist?(input)

puts 'Parsing source XML…'
doc = REXML::Document.new(read_xml(input))
root = doc.root
part = REXML::XPath.first(root, 'part')
abort 'expected a single <part>' unless part && REXML::XPath.match(root, 'part').length == 1

# Chunk measures on page breaks.
chunks = []
state = { clefs: {} }
chunk_states = []
part.elements.each('measure') do |measure|
  new_page = REXML::XPath.first(measure, "print[@new-page='yes']")
  if chunks.empty? || new_page
    # Snapshot of the state *before* this measure. Stored elements are never
    # mutated (update_state replaces them), so a shallow copy is enough.
    chunk_states << state.merge(clefs: state[:clefs].dup)
    chunks << []
  end
  chunks.last << measure
  update_state(state, measure)
end
abort "expected #{EXERCISE_COUNT} exercises, found #{chunks.length}" unless chunks.length == EXERCISE_COUNT

# Tempo direction from exercise 1 (M.M. 60-108) — applies to every exercise.
tempo_direction = REXML::XPath.first(chunks[0][0], "direction[direction-type/metronome]")

chunks.each_with_index do |measures, i|
  number = i + 1

  # Complete the running state with the first measure's own attributes so the
  # merged element reflects the state *at* the exercise start.
  chunk_state = chunk_states[i]
  chunk_state[:clefs] ||= {}
  update_state(chunk_state, measures[0])

  out = REXML::Document.new
  score = out.add_element('score-partwise', 'version' => '3.1')

  work = score.add_element('work')
  work.add_element('work-title').text = format(TITLE_FORMAT, number)

  identification = score.add_element('identification')
  creator = identification.add_element('creator', 'type' => 'composer')
  creator.text = COMPOSER
  identification.add_element('rights').text = 'Public Domain'
  identification.add_element('source').text = SOURCE_URL

  score.add_element(root.elements['defaults'].deep_clone) if root.elements['defaults']
  score.add_element(root.elements['part-list'].deep_clone)

  out_part = score.add_element('part', 'id' => part.attributes['id'])
  measures.each_with_index do |measure, j|
    m = measure.deep_clone
    m.attributes['number'] = (j + 1).to_s

    if j.zero?
      m.elements['print']&.attributes&.delete('new-page')

      # Replace the (partial) attributes with the full merged state.
      insert_after = m.elements['print']
      m.elements.delete('attributes')
      full_attrs = merged_attributes(chunk_state)
      insert_after ? m.insert_after(insert_after, full_attrs) : m.unshift(full_attrs)

      if tempo_direction && !REXML::XPath.first(m, 'direction[direction-type/metronome]')
        m.insert_after(full_attrs, tempo_direction.deep_clone)
      end

      # The source direction is "(M.M. ♩=60 to 108.)" as three sibling
      # direction-types; OSMD stacks them vertically, so keep only the
      # metronome mark (♩=60).
      tempo = REXML::XPath.first(m, 'direction[direction-type/metronome]')
      REXML::XPath.match(tempo, 'direction-type[words]').each { |dt| tempo.delete_element(dt) } if tempo
    end

    out_part.add_element(m)
  end

  filename = format(FILE_FORMAT, number)
  write_mxl(out, File.join(OUTPUT_DIR, filename))
  puts "  #{format(TITLE_FORMAT, number).ljust(14)} #{measures.length.to_s.rjust(3)} mesures → #{filename}"
end

puts "Done: #{EXERCISE_COUNT} files in #{OUTPUT_DIR}"
