/**
 * Fix setting values being to small for the sidebar JSON
 */

require("module-alias/register");
const config = require("server/core/config").default;

exports.up = async function(knex, Promise) {
  try {
    if (config.DB_TYPE === "postgresql") {
      await knex.raw("ALTER TABLE setting ALTER COLUMN value TYPE varchar(10000)");
    }
    Promise.resolve();
  } catch (e) {
    Promise.reject(e);
  }
};

exports.down = async function(knex, Promise) {
  Promise.resolve(); // Nothing
};
