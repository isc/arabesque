require_relative 'test_helper'
require 'tempfile'
require 'json'

class DataTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/data.html'
  end

  def test_import_export_roundtrip
    fixture_path = File.expand_path('fixtures/initial-backup.json', __dir__)

    accept_alert do
      attach_file 'backup-import', fixture_path, make_visible: true
    end

    accept_alert do
      click_button '📤 Exporter sauvegarde'
    end

    exported_file = wait_for_download('arabesque-backup-*.json')
    assert exported_file, 'Export file should be downloaded'

    imported_data = JSON.parse(File.read(fixture_path))
    exported_data = JSON.parse(File.read(exported_file))

    assert exported_data['exportDate'], 'Export should have exportDate'
    assert_includes exported_data['sessions'], imported_data['sessions'].first

    assert exported_data['fingerings'], 'Export should include fingerings'
    assert_includes exported_data['fingerings'], imported_data['fingerings'].first

    File.delete(exported_file)
  end

  def test_import_invalid_backup
    invalid_backup = { exportDate: '2026-01-13T12:00:00.000Z' }.to_json

    backup_file = Tempfile.new(['backup', '.json'])
    backup_file.write(invalid_backup)
    backup_file.close

    alert_message = accept_alert do
      attach_file 'backup-import', backup_file.path, make_visible: true
    end

    assert_includes alert_message, '❌ Erreur lors de l\'import'
    assert_includes alert_message, 'Invalid backup data format'

    backup_file.unlink
  end
end
