require_relative 'test_helper'
require 'json'

# Several people on one device (public/js/profiles.js): each profile has a
# practice history of its own, chosen from the library, managed from the data
# page.
class ProfilesTest < CapybaraTestBase
  FIXTURE = File.expand_path('fixtures/initial-backup.json', __dir__)

  def test_each_profile_keeps_a_practice_history_of_its_own
    visit '/data.html'
    accept_alert { attach_file 'backup-import', FIXTURE, make_visible: true }

    # Alone on the device, nobody is asked who they are.
    visit '/library.html'
    assert_text 'Bibliothèque'
    assert_no_selector '.pt-profile-chip'

    visit '/data.html'
    fill_in 'Prénom', with: 'Léa'
    click_button 'Ajouter un profil'
    assert_field 'Nom', with: 'Léa'

    # The chooser: a tile per profile, the one picked becomes current.
    visit '/library.html'
    find('.pt-profile-chip', text: 'Moi').click
    within('dialog[open]') { click_button 'Léa' }
    assert_selector '.pt-profile-chip', text: 'Léa'

    # Léa starts from nothing, in a file named after her, accent folded.
    visit '/data.html'
    accept_alert { click_button '📤 Exporter sauvegarde' }
    exported = wait_for_download('arabesque-backup-lea-2*.json')
    assert_empty JSON.parse(File.read(exported))['sessions']

    # Back on the first profile, the history is where it was.
    click_button 'Activer'
    accept_alert { click_button '📤 Exporter sauvegarde' }
    exported = wait_for_download('arabesque-backup-2*.json')
    assert_equal JSON.parse(File.read(FIXTURE))['sessions'].length,
                 JSON.parse(File.read(exported))['sessions'].length

    # Deleting Léa, with a warning first.
    click_button 'Supprimer'
    assert_text 'Tout ce que Léa a joué sera effacé'
    click_button 'Oui, supprimer Léa'
    assert_no_field 'Nom', with: 'Léa'

    visit '/library.html'
    assert_text 'Bibliothèque'
    assert_no_selector '.pt-profile-chip'
  end
end
