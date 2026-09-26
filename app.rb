require 'sinatra/base'

class App < Sinatra::Base
  configure do
    set :port, 4567
    set :bind, '0.0.0.0'
    set :public_folder, "#{File.dirname(__FILE__)}/public"
    set :static, true
  end

  # Landing page (pitch + onboarding) served at the root. The score library is
  # public/library.html, reached via relative links (library.html) so it works
  # both here and on static hosting (GitHub Pages) under a project subpath.
  get '/' do
    send_file File.join(settings.public_folder, 'index.html')
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
