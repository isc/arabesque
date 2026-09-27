require_relative 'test_helper'
require 'tempfile'
require 'json'

class DataTest < CapybaraTestBase
  FIXTURE = File.expand_path('fixtures/initial-backup.json', __dir__)

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/data.html'
  end

  def test_import_export_roundtrip
    accept_alert do
      attach_file 'backup-import', FIXTURE, make_visible: true
    end

    accept_alert do
      click_button '📤 Exporter sauvegarde'
    end

    exported_file = wait_for_download('arabesque-backup-*.json')
    assert exported_file, 'Export file should be downloaded'

    imported_data = JSON.parse(File.read(FIXTURE))
    exported_data = JSON.parse(File.read(exported_file))

    assert exported_data['exportDate'], 'Export should have exportDate'
    assert_includes exported_data['sessions'], imported_data['sessions'].first

    assert exported_data['fingerings'], 'Export should include fingerings'
    assert_includes exported_data['fingerings'], imported_data['fingerings'].first

    File.delete(exported_file)
  end

  # A piece left mid-way is closed by the next page to open, through the
  # tracker's init. This page used to open storage alone, which left the
  # session just played open: missing from the export, and from "Synchroniser
  # maintenant", which only pushes ended sessions.
  def test_the_piece_just_left_is_closed_before_anything_is_exported
    visit '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
    play_note('C4')
    wait_for_records('sessions', where: '!record.endedAt')
    # The clean close runs on beforeunload, and here its writes would land
    # before the page is gone. On a device they often don't, which is the case
    # at hand: with them never landing, the open row and the snapshot pagehide
    # leaves in localStorage are all the next page gets.
    page.execute_script('IDBObjectStore.prototype.put = () => ({})')

    visit '/data.html'
    wait_for_records('sessions', where: 'record.endedAt')
  end

  # A backup joins the practice already on the device, as a sync's pull does.
  # Its aggregates used to be written over this device's, so the statuses and
  # practice times forgot everything played here on that score. The score is
  # in no catalog and its sessions carry no name: the title can only come from
  # the backup's aggregate.
  def test_an_imported_backup_counts_alongside_the_practice_already_here
    seed_store('sessions', [JSON.parse(File.read(FIXTURE))['sessions'].first.merge('id' => 'played-here')])

    accept_alert do
      attach_file 'backup-import', FIXTURE, make_visible: true
    end

    wait_for_records('aggregates', where: "record.scoreId === '/scores/test-roundtrip.xml' && record.totalSessions === 2 " \
                                          "&& record.scoreTitle === 'Test Roundtrip Score'")
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
