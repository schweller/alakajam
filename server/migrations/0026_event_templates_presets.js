/**
 * Create event template & preset tables
 */

require("module-alias/register");
const config = require("server/core/config").default;

exports.up = async function(knex, Promise) {
  try {
    await knex.schema.createTable("event_preset", (table) => {
      table.increments("id").primary();
      table.string("title");
      table.string("status");
      table.string("status_rules");
      table.string("status_theme");
      table.string("status_entry");
      table.string("status_results");
      table.string("status_tournament");
      table.string("countdown_config", 1000);
    });

    await knex.schema.createTable("event_template", (table) => {
      table.increments("id").primary();
      table.string("title");
      table.string("event_title");
      table.integer("event_preset_id").references("event_preset.id");
      table.string("links", 2000);
      table.string("divisions", 2000);
      table.string("category_titles", 1000);
    });

    if (config.DB_TYPE === "postgresql") {
      await knex.raw("alter table event alter column countdown_config type varchar(1000)");
    }

    await knex.schema.table("event", (table) => {
      table.integer("event_preset_id").references("event_preset.id");
    });

    Promise.resolve();
  } catch (e) {
    console.log(e.message);
    Promise.reject(e);
  }
};

exports.down = async function(knex, Promise) {
  try {
    if (config.DB_TYPE === "postgresql") {
      await knex.raw("alter table event alter column countdown_config type varchar(255)");
    }
    await knex.schema.table("event", (table) => {
      table.dropColumn("event_preset_id");
    });

    await knex.schema.dropTableIfExists("event_template");
    await knex.schema.dropTableIfExists("event_preset");

    Promise.resolve();
  } catch (e) {
    console.log(e.message);
    Promise.reject(e);
  }
};
