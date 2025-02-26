/**
 * Logging configuration (uses Winston).
 *
 * @description ## Usage
 * ```
 * log.debug('message')
 * log.info('message')
 * log.warn('message')
 * log.error('message')
 * ```
 *
 * @module core/log
 */

import { sync as findUp } from "find-up";
import * as moment from "moment";
import * as path from "path";
import * as util from "util";
import { config as winstonConfig, Logger, transports } from "winston";

const sourcesRoot = path.dirname(findUp("package.json", { cwd: __dirname }));

let level = "info";
try {
  // tslint:disable-next-line: no-var-requires
  const config = require("./config");
  level = config.LOG_LEVEL;
} catch (e) {
  // Nothing (config file might not be created yet)
}

/*
 * Configure the Winston logger to print pretty, colorful & informative log lines
 */
const log = new Logger({
  level,
  transports: [
    new transports.Console({
      colorize: true,
      timestamp: () => moment().format("YYYY-MM-DD hh:mm:ss.SSS"),
      formatter: (options) => {
        // Figure out the logging caller location
        // XXX slow and hacky approach
        let location = "?";
        const lines = new Error().stack.split("\n");
        for (const line of lines) {
          if (line.indexOf(sourcesRoot) !== -1 &&
              line.indexOf(__filename) === -1 &&
              line.indexOf("node_modules") === -1) {
            const locInfo = line.replace(/(.*\()/g, "")
              .replace(process.cwd(), "")
              .split(/[ :]/g);
            location = locInfo[locInfo.length - 3].replace("\\", "") +
              ":" + locInfo[locInfo.length - 2];
            break;
          }
        }

        // Build the logging line
        const prefix = options.timestamp() + " " + options.level.toUpperCase() + " (" + location + ")";
        const message = options.message ? (" " + util.format(options.message)) : "";
        return winstonConfig.colorize(options.level, prefix) + message;
      },
    })
  ]
});

/**
 * Logs the current stacktrace at info level
 */
(log as any).whereami = () => {
  const lines = new Error().stack.split("\n");
  log.info("I am" + lines.slice(2).join("\n"));
};

export default log;
