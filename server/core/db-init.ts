import * as moment from "moment";

import eventRatingService from "../services/event-rating-service";
import eventService from "../services/event-service";
import eventThemeService from "../services/event-theme-service";
import postService from "../services/post-service";
import settingService from "../services/setting-service";
import userService from "../services/user-service";
import constants from "./constants";
import db from "./db";
import enums from "./enums";
import fileStorage from "./file-storage";
import log from "./log";

/**
 * Inserts sample data in the database.
 * @param {bool|string} samples true to add samples, 'nightly' to add the special nighly post
 * @returns {void}
 */
export async function insertInitialData(samples) {
  const knex = db.knex;

  // Mandatory admin account & important settings

  await userService.register("administrator@example.com", "administrator", "administrator");
  const adminUser = await userService.findByName("administrator");
  adminUser.set({
    title: "Administrator",
    is_admin: true,
  });
  await adminUser.save();

  await settingService.save(constants.SETTING_EVENT_REQUIRED_ENTRY_VOTES, 1);
  await settingService.save(constants.SETTING_EVENT_THEME_ELIMINATION_MODULO, 5);
  await settingService.save(constants.SETTING_EVENT_THEME_ELIMINATION_MIN_NOTES, 1);
  await settingService.save(constants.SETTING_EVENT_THEME_IDEAS_REQUIRED, 5);
  await settingService.save(constants.SETTING_ARTICLE_SIDEBAR, defaultArticleSidebar());

  // Samples

  if (samples) {
    log.info("Inserting samples (this can take a while)...");

    // Users

    await userService.register("entrant@example.com", "entrant", "entrant");
    const entrantUser = await userService.findByName("entrant");
    entrantUser.set({
      title: "Entrant",
    });
    await entrantUser.related("details").set({
      body: "I am definitely **not** a robot.",
    }).save();

    // 1st event

    const event1 = eventService.createEvent();
    event1.set({
      title: "1st Alakajam",
      name: "1st-alakajam",
      status: enums.EVENT.STATUS.CLOSED,
      display_dates: "Novembary 17 - 20, 2016",
      display_theme: "Make a website",
      status_theme: enums.EVENT.STATUS_THEME.DISABLED,
      status_entry: enums.EVENT.STATUS_ENTRY.OFF,
      status_results: enums.EVENT.STATUS_RESULTS.DISABLED,
    });
    await event1.save();
    let userEntry = await eventService.createEntry(entrantUser, event1);
    userEntry.set("title", "Old Game");
    await userEntry.save();

    // 2nd event

    const event2 = eventService.createEvent();
    event2.set({
      title: "2nd Alakajam",
      name: "2nd-alakajam",
      status: enums.EVENT.STATUS.OPEN,
      display_dates: "Januember 29 - 31, 2017",
      display_theme: "You are not alone",
      status_theme: enums.EVENT.STATUS_THEME.VOTING,
      status_entry: enums.EVENT.STATUS_ENTRY.OPEN,
      status_results: enums.EVENT.STATUS_RESULTS.VOTING,
      countdown_config: {
        phrase: "starts",
        date: moment().add(1, "days").toDate(),
        enabled: false,
      },
    });
    await event2.save();
    const event2Details = event2.related("details");
    event2Details.set({
      category_titles: ["Overall", "Graphics", "Audio", "Gameplay", "Originality", "Theme"],
    });
    await event2Details.save();

    await settingService.save(constants.SETTING_FEATURED_EVENT_NAME, "2nd-alakajam");

    eventThemeService.saveThemeIdeas(entrantUser, event2, [
      { title: "Alone" },
      { title: "Evolution" },
      { title: "Two buttons" },
    ]);

    const adminEntry = await eventService.createEntry(adminUser, event2);
    adminEntry.set("title", "Super Game");
    await adminEntry.save();

    userEntry = await eventService.createEntry(entrantUser, event2);
    userEntry.set("title", "Game 1");
    userEntry.set("published_at", new Date());
    await userEntry.save();

    for (let i = 2; i <= 10; i++) {
      await userService.register("entrant@example.com", "entrant" + i, "entrant" + i);
      const otherUser = await userService.findByName("entrant" + i);
      const otherEntry = await eventService.createEntry(otherUser, event2);
      otherEntry.set("title", "Game " + i);
      otherEntry.set("published_at", new Date());
      await otherEntry.save();
    }
    for (let i = 2; i <= 10; i++) {
      const userA = await userService.findByName("entrant" + i);
      for (let j = 1; j <= 10; j++) {
        let ji = (i + j) % 11;
        if (ji < 2) {
          ji = 2;
        }
        const userB = await userService.findByName("entrant" + ji);
        const entryB = await eventService.findUserEntryForEvent(userB, event2.get("id"));
        const votes = [];
        for (let k = 0; k < 6; k++) {
          votes[k] = 3 + Math.floor(Math.random() * 4);
        }
        await eventRatingService.saveEntryVote(userA, entryB, event2, votes);
      }
    }

    let post = await postService.createPost(entrantUser, event2.get("id"));
    post.set({
      title: "I'm in!",
      body: "This is my second game and I'm really excited.",
      event_id: event2.get("id"),
      entry_id: userEntry.get("id"),
      published_at: new Date(),
    });
    await post.save();

    post = await postService.createPost(adminUser, event2.get("id"));
    post.set({
      title: "Event started!",
      body: "The theme is `You are not alone`. Have fun!",
      event_id: event2.get("id"),
      special_post_type: constants.SPECIAL_POST_TYPE_ANNOUNCEMENT,
      published_at: new Date(),
    });
    if (samples === "nightly") {
      const nightlyPostBuffer = await fileStorage.read("deployment/NIGHTLY_POST.md");
      const changesBuffer = await fileStorage.read("CHANGES.md");
      post.set({
        title: "Nightly: " + moment().format("MMMM Do YYYY"),
        body: nightlyPostBuffer.toString() + changesBuffer.toString(),
      });
    }
    await post.save();
    event2.set("status_rules", post.get("id"));
    await event2.save();

    await postService.createComment(entrantUser, post, "I'm in!");
    await postService.refreshCommentCount(post);

    // Planned 3rd event

    const event3 = eventService.createEvent();
    event3.set({
      title: "3rd Alakajam",
      name: "3rd-alakajam",
      status: enums.EVENT.STATUS.PENDING,
      display_dates: "Marchpril 5 - 8, 2017",
      status_theme: enums.EVENT.STATUS_THEME.OFF,
      status_entry: enums.EVENT.STATUS_ENTRY.OFF,
      status_results: enums.EVENT.STATUS_RESULTS.OFF,
    });
    await event3.save();

    // Platforms
    const platformNames = [
      "Linux",
      "Mac",
      "Windows",
      "Web",
      "Mobile",
      "Retro",
    ];
    const now = knex.fn.now();
    await knex("platform").insert(platformNames.map((name) => ({
      name,
      created_at: now,
      updated_at: now,
    })));

    log.info("Samples inserted");
  }
}

function defaultArticleSidebar() {
  return `{
    "sidebar": [
        {
            "title": "General",
            "links": [
                {
                    "title": "Welcome",
                    "url": "/article/docs"
                },
                {
                    "title": "F.A.Q.",
                    "url": "/article/faq"
                },
                {
                    "title": "Game making resources",
                    "url": "/article/resources"
                },
                {
                    "title": "Press kit",
                    "url": "/article/press-kit"
                },
                {
                    "title": "Contributing",
                    "url": "/article/contributing"
                },
                {
                    "title": "Privacy policy",
                    "url": "/article/privacy-policy"
                }
            ]
        },
        {
            "title": "Events rules",
            "links": [
                {
                    "title": "Alakajam!",
                    "url": "/article/alakajam-competition-rules"
                },
                {
                    "title": "Kajam",
                    "url": "/article/kajam-rules"
                },
                {
                    "title": "Feedback Fortnight",
                    "url": "/article/feedback-fortnight-rules"
                }
            ]
        },
        {
            "title": "Game jam tips",
            "links": [
                {
                    "title": "Managing scope",
                    "url": "/article/gjt-scope"
                },
                {
                    "title": "Skills",
                    "url": "/article/gjt-skills"
                },
                {
                    "title": "Social media",
                    "url": "/article/gjt-social"
                },
                {
                    "title": "Timelapses",
                    "url": "/article/gjt-timelapses"
                }
            ]
        },
        {
            "title": "Behind the scenes",
            "links": [
                {
                    "title": "JSON API",
                    "url": "/api"
                },
                {
                    "title": "Site changelog",
                    "url": "/changes"
                },
                {
                    "title": "NPO constitution",
                    "url": "/article/constitution"
                }
            ]
        }
    ]
}`;
}
