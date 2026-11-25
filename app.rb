require 'json'
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

  # Branch previews, the way GitHub Pages serves them (CLAUDE.md, "Branch
  # previews"): the open ones listed in previews/index.json, each a build of the
  # site under previews/<slug>/ — here, this same build. A slug the list does not
  # name has no preview, and gets the 404 page as any missing file does.
  PREVIEWS_INDEX = File.join(__dir__, 'test', 'fixtures', 'previews-index.json')
  PREVIEW_SLUGS = JSON.parse(File.read(PREVIEWS_INDEX)).map { |preview| preview['slug'] }

  get '/previews/index.json' do
    send_file PREVIEWS_INDEX
  end

  get '/previews/:slug/*' do
    pass unless PREVIEW_SLUGS.include?(params['slug'])
    serve_public params['splat'].first
  end

  # Route catch-all pour servir les fichiers statiques
  get '*' do
    serve_public request.path_info
  end

  helpers do
    def serve_public(path)
      file_path = File.join(settings.public_folder, path)
      if File.file?(file_path)
        send_file file_path
      else
        send_file File.join(settings.public_folder, '404.html'), status: 404
      end
    end
  end

  # Démarrer l'application si ce fichier est exécuté directement
  run! if app_file == $PROGRAM_NAME
end
