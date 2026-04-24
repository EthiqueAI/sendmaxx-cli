import { Command } from "commander";
import { setOverrides } from "./config.js";
import { registerAuth } from "./commands/auth.js";
import { registerContacts } from "./commands/contacts.js";
import { registerCampaigns } from "./commands/campaigns.js";
import { registerLists } from "./commands/lists.js";
import { registerPipeline } from "./commands/pipeline.js";
import { registerReplies } from "./commands/replies.js";
import { registerAlerts } from "./commands/alerts.js";

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
    setOverrides(opts.token, opts.url);
  });

registerAuth(program);
registerContacts(program);
registerCampaigns(program);
registerLists(program);
registerPipeline(program);
registerReplies(program);
registerAlerts(program);

program.parseAsync(process.argv);
