# UTF-8 whatever the locale says, once per process — see the Rakefile. Reached
# through test_helper.rb under test, and on its own when run as the dev server.
Encoding.default_external = Encoding::UTF_8 unless Encoding.default_external == Encoding::UTF_8

require 'sinatra/base'
require 'json'
require 'fileutils'

class App < Sinatra::Base
  class ValidationError < StandardError
  end

  configure do
    set :port, 4567
    set :bind, '0.0.0.0'
    set :public_folder, "#{File.dirname(__FILE__)}/public"
    set :static, true

    cassettes_dir = File.join(__dir__, 'public', 'cassettes')
    FileUtils.mkdir_p(cassettes_dir)
  end

  helpers do
    def parse_request_body
      JSON.parse(request.body.read)
    end

    def validate_cassette_data(data)
      name = data['name']
      midi_data = data['data']

      raise ValidationError, 'Le nom de la cassette est requis' if name.nil? || name.empty?

      return unless midi_data.nil? || !midi_data.is_a?(Array)

      raise ValidationError,
            'Les données MIDI sont requises et doivent être un tableau'
    end

    def build_cassette_filepath(clean_name)
      filename = "#{clean_name}.json"
      cassettes_dir = File.join(settings.public_folder, 'cassettes')
      File.join(cassettes_dir, filename)
    end

    def save_cassette_file(filepath, name, midi_data)
      cassette = {
        name:,
        created_at: Time.now.iso8601,
        data: midi_data
      }
      File.write(filepath, JSON.generate(cassette))
    end

    def success_response(clean_name)
      status 200
      {
        success: true,
        message: 'Cassette sauvegardée avec succès',
        file: "cassettes/#{clean_name}.json"
      }.to_json
    end

    def error_response(status_code, message)
      status status_code
      { error: message }.to_json
    end

    def sanitize_cassette_name(name)
      name.gsub(/[^a-zA-Z0-9_-]/, '_')
    end
  end

  # Landing page (pitch + onboarding) served at the root. The score library is
  # public/library.html, reached via relative links (library.html) so it works
  # both here and on static hosting (GitHub Pages) under a project subpath.
  get '/' do
    send_file File.join(settings.public_folder, 'index.html')
  end

  # API pour lister les cassettes disponibles
  get '/api/cassettes' do
    content_type :json

    cassettes = []
    cassettes_dir = File.join(settings.public_folder, 'cassettes')
    Dir.glob(File.join(cassettes_dir, '*.json')).each do |file|
      name = File.basename(file, '.json')
      cassettes << {
        name:,
        file: "cassettes/#{name}.json",
        created_at: File.mtime(file).iso8601
      }
    end

    cassettes.to_json
  end

  # API pour sauvegarder une nouvelle cassette
  post '/api/cassettes' do
    content_type :json

    begin
      data = parse_request_body
      validate_cassette_data(data)

      clean_name = sanitize_cassette_name(data['name'])
      filepath = build_cassette_filepath(clean_name)

      save_cassette_file(filepath, data['name'], data['data'])

      success_response(clean_name)
    rescue JSON::ParserError
      error_response(400, 'Format JSON invalide')
    rescue ValidationError => e
      error_response(400, e.message)
    rescue StandardError => e
      error_response(500, "Erreur serveur: #{e.message}")
    end
  end

  # Serve test fixtures in test environment
  get '/test-fixtures/*' do
    fixture_path = File.join(__dir__, 'test', 'fixtures', params['splat'].first)
    if File.exist?(fixture_path) && File.file?(fixture_path)
      send_file fixture_path
    else
      status 404
      'Fixture non trouvée'
    end
  end

  # Route catch-all pour servir les fichiers statiques
  get '*' do
    file_path = File.join(settings.public_folder, request.path_info)
    if File.exist?(file_path) && File.file?(file_path)
      send_file file_path
    else
      status 404
      'Fichier non trouvé'
    end
  end

  # Démarrer l'application si ce fichier est exécuté directement
  run! if app_file == $PROGRAM_NAME
end
