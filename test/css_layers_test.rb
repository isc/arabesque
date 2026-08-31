require 'minitest/autorun'

# styles.css puts every rule in a cascade layer, and the whole point is that
# layer order decides precedence instead of specificity. One mistake undoes it:
# a rule appended after the last closer sits outside every layer and outranks
# the entire file. The natural place to add CSS is the end of the file, which is
# exactly that spot — hence a test rather than a comment.
class CssLayersTest < Minitest::Test
  STYLESHEET = File.expand_path('../public/styles.css', __dir__)

  def setup
    @source = File.read(STYLESHEET)
    # Comments and quoted strings hold braces of their own (the icon data: URIs
    # are full of them), so they go before anything counts brackets. A blanked
    # comment keeps its newlines, or every line number reported below would be
    # short by the length of the comments above it.
    @stripped = @source
                .gsub(%r{/\*.*?\*/}m) { |comment| "\n" * comment.count("\n") }
                .gsub(/"[^"]*"/, '""')
  end

  def test_every_rule_lives_inside_a_layer
    depth = 0
    outside = []
    @stripped.each_line.with_index(1) do |line, number|
      # A line at depth 0 that is neither blank nor an at-rule opening a layer
      # is a rule nobody can override.
      stripped = line.strip
      if depth.zero? && !stripped.empty? && !stripped.start_with?('@layer', '}')
        outside << "#{number}: #{stripped[0, 60]}"
      end
      depth += line.count('{') - line.count('}')
    end

    assert_empty outside, <<~MESSAGE
      These lines sit outside every cascade layer, so they beat all of styles.css
      whatever their selector weighs. Move them into @layer components (or
      @layer utilities if the rule must win against components too):

      #{outside.join("\n")}
    MESSAGE
  end

  def test_the_layer_order_is_declared_before_any_layer_block
    declaration = @stripped[/@layer\s+([a-z,\s]+);/, 1]
    refute_nil declaration, 'styles.css must declare its layer order up front'

    declared = declaration.split(',').map(&:strip)
    assert_equal %w[tokens base components utilities], declared,
                 'the declaration is what fixes precedence — order matters here'

    opened = @stripped.scan(/@layer\s+([a-z]+)\s*\{/).flatten
    assert_equal declared.sort, opened.sort,
                 'every declared layer should be used, and every used one declared'
    assert_operator @stripped.index('@layer %s;' % declaration), :<,
                    @stripped.index("@layer #{opened.first} {"),
                    'the order declaration has to come before the first block'
  end

  # Blocks that never close (or close twice) would silently swallow or expose
  # whole sections, and the file is too long to eyeball.
  def test_the_layer_blocks_are_balanced
    assert_equal @stripped.count('{'), @stripped.count('}'),
                 'unbalanced braces in styles.css'
  end
end
