import { Command } from 'commander';
import { doctorCommand, notifyCommand, releaseCommand, versionsCommand } from './cli/commands.js';
import { JiraError } from './jira/client.js';
import { c } from './util/console.js';
import { UserError } from './util/errors.js';

function run<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') {
        console.log('\nİptal edildi, hiçbir değişiklik yapılmadı.');
        process.exitCode = 130;
      } else if (err instanceof UserError || err instanceof JiraError) {
        console.error(c.red(`✖ ${err.message}`));
        process.exitCode = 1;
      } else {
        console.error(c.red('✖ Beklenmeyen hata:'), err);
        process.exitCode = 1;
      }
    }
  };
}

const program = new Command()
  .name('teams-prod-info')
  .description("Canlı çıkış sonrası Jira release'ini tamamlar ve Teams kanalına bildirir.");

program
  .command('release')
  .description('"To be Deployed" maddeleri "Completed" yapar, release\'i kapatır, Teams\'e bildirir')
  .option('-p, --project <key>', 'Jira proje anahtarı (örn. OE)')
  .option('-v, --version <name>', 'Release adı (verilmezse listeden seçilir)')
  .option('-d, --date <datetime>', 'Canlı çıkış zamanı, örn. "2026-09-23 14:30" (varsayılan: şimdi)')
  .option('--dry-run', 'Sadece önizleme; hiçbir şey değiştirmez')
  .option('-y, --yes', 'Onay sormadan çalıştır (otomasyon/Jenkins için)')
  .option('--no-comment', 'Maddelere yorum ekleme')
  .option('--no-notify', "Teams'e bildirim gönderme")
  .option('--release-with-errors', 'Hatalı madde olsa bile release\'i "Released" yap')
  .action(run(releaseCommand));

program
  .command('versions')
  .description("Unreleased release'leri ve bekleyen madde sayılarını listeler")
  .option('-p, --project <key>', 'Jira proje anahtarı')
  .action(run(versionsCommand));

program
  .command('doctor')
  .description('Jira bağlantısı, yetkiler, statüler ve Teams webhook ayarını kontrol eder')
  .option('-p, --project <key>', 'Sadece bu projeyi kontrol et')
  .option('--teams-test', 'Teams kanalına test mesajı gönder')
  .action(run(doctorCommand));

program
  .command('notify')
  .description('Bir çalıştırmanın Teams bildirimini log dosyasından tekrar gönderir')
  .requiredOption('-l, --log <file>', 'logs/ altındaki JSON kayıt dosyası')
  .action(run(notifyCommand));

await program.parseAsync();
