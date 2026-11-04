import { Command } from "commander";
import chalk from "chalk";
import { setOverrides } from "./config.js";

const TEAL = "#2E9E91";
const BANNER = `
███████╗███████╗███╗   ██╗██████╗ ███╗   ███╗ █████╗ ██╗  ██╗██╗  ██╗
██╔════╝██╔════╝████╗  ██║██╔══██╗████╗ ████║██╔══██╗╚██╗██╔╝╚██╗██╔╝
███████╗█████╗  ██╔██╗ ██║██║  ██║██╔████╔██║███████║ ╚███╔╝  ╚███╔╝
╚════██║██╔══╝  ██║╚██╗██║██║  ██║██║╚██╔╝██║██╔══██║ ██╔██╗  ██╔██╗
███████║███████╗██║ ╚████║██████╔╝██║ ╚═╝ ██║██║  ██║██╔╝ ██╗██╔╝ ██╗
╚══════╝╚══════╝╚═╝  ╚═══╝╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
`;
const TAGLINE = "       SendMaxx CLI — talk to your SendMaxx instance from the shell\n";
import { registerAuth } from "./commands/auth.js";
import { registerContacts } from "./commands/contacts.js";
import { registerCampaigns } from "./commands/campaigns.js";
import { registerLists } from "./commands/lists.js";
import { registerPipeline } from "./commands/pipeline.js";
import { registerReplies } from "./commands/replies.js";
import { registerAlerts } from "./commands/alerts.js";
import { registerTags } from "./commands/tags.js";
import { registerIcps } from "./commands/icps.js";
import { registerEmails } from "./commands/emails.js";
import { registerCalls } from "./commands/calls.js";

const program = new Command();

program
  .name("sendmaxx")
  .description("SendMaxx CLI — interact with your SendMaxx instance")
  .version("0.1.0")
  .option("--token <token>", "API token (overrides stored config)")
  .option("--url <url>", "Base URL (overrides stored config)")
  .option("--pretty", "Output formatted table instead of JSON")
  .hook("preAction", () => {
    const opts = program.opts();
    setOverrides(opts.token?.trim(), opts.url?.trim());
  });

program.addHelpText("before", () => chalk.hex(TEAL)(BANNER) + chalk.hex(TEAL).dim(TAGLINE));

registerAuth(program);
registerContacts(program);
registerCampaigns(program);
registerEmails(program);
registerLists(program);
registerTags(program);
registerIcps(program);
registerPipeline(program);
registerReplies(program);
registerCalls(program);
registerAlerts(program);

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}
program.parseAsync(process.argv);
