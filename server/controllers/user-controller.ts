
/**
 * User and authentication pages
 *
 * @module controllers/user-controller
 */

import cache from "../core/cache";
import constants from "../core/constants";
import enums from "../core/enums";
import fileStorage from "../core/file-storage";
import forms from "../core/forms";
import entryImportService from "../services/entry-import-service";
import eventService from "../services/event-service";
import highScoreService from "../services/highscore-service";
import likeService from "../services/like-service";
import postService from "../services/post-service";
import securityService from "../services/security-service";
import userService from "../services/user-service";

export default {
  dashboardMiddleware,

  viewUserProfile,

  dashboardFeed,
  dashboardEntries,
  dashboardPosts,
  dashboardScores,
  dashboardSettings,
  dashboardPassword,
  dashboardEntryImport,

  registerForm,
  doRegister,
  loginForm,
  doLogin,
  doLogout,

  passwordRecoveryRequest,
  passwordRecovery,
};

async function dashboardMiddleware(req, res, next) {
  res.locals.pageTitle = "User dashboard";

  if (!res.locals.user || res.locals.user === undefined) {
    res.errorPage(403, "You are not logged in.");
  } else {
    if (req.query.user && securityService.isAdmin(res.locals.user) &&
        req.query.user !== res.locals.user.get("name")) {
      res.locals.dashboardUser = await userService.findByName(forms.sanitizeString(req.query.user));
      res.locals.dashboardAdminMode = true;
    } else {
      res.locals.dashboardUser = res.locals.user;
    }
    next();
  }
}

/**
 * Display a user profile
 */
async function viewUserProfile(req, res) {
  const profileUser = await userService.findByName(req.params.name);
  if (profileUser) {
    res.locals.pageTitle = profileUser.get("title");
    res.locals.pageDescription = forms.markdownToText(profileUser.related("details").get("body"));

    const [entries, posts, scores] = await Promise.all([
      eventService.findUserEntries(profileUser),
      postService.findPosts({ userId: profileUser.get("id") }),
      highScoreService.findUserScores(profileUser.get("id"), { sortBy: "ranking" }),
      profileUser.load("details"),
    ]);

    const alakajamEntries = [];
    const otherEntries = [];
    const externalEntries = [];
    entries.models.forEach((entry) => {
      if (entry.get("external_event") != null) {
        externalEntries.push(entry);
      } else if (entry.related("event").get("status_theme") !== enums.EVENT.STATUS_THEME.DISABLED) {
        alakajamEntries.push(entry);
      } else {
        otherEntries.push(entry);
      }
    });

    res.render("user/profile", {
      profileUser,
      alakajamEntries,
      otherEntries,
      externalEntries,
      posts,
      userScores: scores.models,
      medals: scores.countBy((userScore) => userScore.get("ranking")),
      userLikes: await likeService.findUserLikeInfo(posts, res.locals.user),
    });
  } else {
    res.errorPage(404, "No user exists with name " + req.params.name);
  }
}

/**
 * View comment feed
 */
async function dashboardFeed(req, res) {
  const dashboardUser = res.locals.dashboardUser;

  // if an entry is not in the cache it will return undefined
  const userCache = cache.user(dashboardUser);
  let byUserCollection = userCache.get<any>("byUserCollection");
  let toUserCollection = userCache.get<any>("toUserCollection");
  let latestEntry = userCache.get<any>("latestEntry");
  let latestPostsCollection = userCache.get<any>("latestPostsCollection");

  if (!byUserCollection) {
    byUserCollection = await postService.findCommentsByUser(dashboardUser);
    userCache.set("byUserCollection", byUserCollection);
  }
  if (!toUserCollection) {
    toUserCollection = await postService.findCommentsToUser(dashboardUser);
    userCache.set("toUserCollection", toUserCollection);
  }
  if (!latestEntry) {
    latestEntry = await eventService.findLatestUserEntry(dashboardUser);
    userCache.set("latestEntry", latestEntry);
  }
  if (!latestPostsCollection) {
    latestPostsCollection = await postService.findPosts({
      userId: dashboardUser.id,
    });
    userCache.set("latestPostsCollection", latestPostsCollection);
  }
  const invitesCollection = await eventService.findEntryInvitesForUser(dashboardUser, {
    withRelated: ["entry.event", "entry.userRoles", "invited"],
  });

  const notificationsLastRead = dashboardUser.get("notifications_last_read");
  if (!res.locals.dashboardAdminMode) {
    dashboardUser.set("notifications_last_read", new Date());
    await dashboardUser.save();
    userCache.del("unreadNotifications");
    res.locals.unreadNotifications = 0;
  }

  // TODO Limit at the SQL-level
  res.render("user/dashboard-feed", {
    byUser: byUserCollection.take(20),
    toUser: toUserCollection.take(20),
    latestEntry,
    latestPosts: latestPostsCollection.take(3),
    invites: invitesCollection.models,
    notificationsLastRead,
  });
}

/**
 * Manage user entries
 */
async function dashboardEntries(req, res) {
  const entryCollection = await eventService.findUserEntries(res.locals.user);

  const alakajamEntries = [];
  const otherEntries = [];
  const externalEntries = [];
  entryCollection.models.forEach((entry) => {
    if (entry.get("external_event") != null) {
      externalEntries.push(entry);
    } else if (entry.related("event").get("status_theme") !== enums.EVENT.STATUS_THEME.DISABLED) {
      alakajamEntries.push(entry);
    } else {
      otherEntries.push(entry);
    }
  });

  res.render("user/dashboard-entries", {
    alakajamEntries,
    otherEntries,
    externalEntries,
  });
}

/**
 * Manage user posts
 */
async function dashboardPosts(req, res) {
  let newPostEvent = await eventService.findEventByStatus("open");
  if (!newPostEvent) {
    newPostEvent = await eventService.findEventByStatus("pending");
  }
  const allPostsCollection = await postService.findPosts({
    userId: res.locals.dashboardUser.get("id"),
    allowDrafts: true,
  });
  const draftPosts = allPostsCollection.where({ published_at: null });

  res.render("user/dashboard-posts", {
    publishedPosts: allPostsCollection.difference(draftPosts),
    draftPosts,
    newPostEvent,
  });
}

/**
 * Manage user entries
 */
async function dashboardScores(req, res) {
  const sortedBy = forms.sanitizeString(req.query.sortBy) || "updated_at";

  const userScoresCollection = await highScoreService.findUserScores(res.locals.user.get("id"), { sortBy: sortedBy });
  const activeEntriesCollection = await highScoreService.findRecentlyActiveEntries({ limit: 5 });
  const entriesLastActivity = await highScoreService.findEntriesLastActivity(
    userScoresCollection.map((entryScore) => entryScore.get("entry_id")));

  const userScores = userScoresCollection.models;
  if (sortedBy === "activity") {
    userScores.sort((score1, score2) =>
      entriesLastActivity[score2.get("entry_id")] - entriesLastActivity[score1.get("entry_id")]);
  }

  res.render("user/dashboard-scores", {
    userScores,
    activeEntries: activeEntriesCollection.models,
    entriesLastActivity,
    sortedBy,
    medals: userScoresCollection.countBy((userScore) => userScore.get("ranking")),
  });
}

/**
 * Manage general user info
 */
async function dashboardSettings(req, res) {
  await res.locals.dashboardUser.load("details");

  let errorMessage = res.locals.errorMessage;
  const infoMessage = "";

  if (req.method === "POST") {
    const dashboardUser = res.locals.dashboardUser;
    if (req.body.delete) {
      // Account deletion
      const deletingOwnAccount = res.locals.user.get("id") === res.locals.dashboardUser.get("id");
      const result = await userService.deleteUser(res.locals.dashboardUser);
      if (!result.error) {
        if (deletingOwnAccount) {
          doLogout(req, res);
        } else {
          res.redirect("/people");
        }
        return;
      } else {
        errorMessage = result.error;
      }
    } else {
      if (!forms.isEmail(req.body.email)) {
        errorMessage = "Invalid email";
      } else if (req.body.social_web && !forms.isURL(req.body.social_web)) {
        errorMessage = "Invalid URL";
      } else if (!res.locals.dashboardAdminMode && req.body["special-permissions"]) {
        errorMessage = "Not allowed to change special permissions on this user";
      } else if (!res.locals.dashboardAdminMode && req.body["disallow-anonymous"]) {
        errorMessage = "Not allows to change anonymous comments settings on this user";
      } else if (req.file && !(await fileStorage.isValidPicture(req.file.path))) {
        errorMessage = "Invalid picture format (allowed: PNG GIF JPG)";
      }

      if (!errorMessage) {
        // General settings form
        dashboardUser.set("title", forms.sanitizeString(req.body.title || dashboardUser.get("name")));
        dashboardUser.set("email", req.body.email);
        if (req.body["special-permissions"]) {
          const isMod = req.body["special-permissions"] === "mod" || req.body["special-permissions"] === "admin";
          const isAdmin = req.body["special-permissions"] === "admin";
          dashboardUser.set({
            is_mod: isMod ? "true" : "",
            is_admin: isAdmin ? "true" : "",
          });
        }

        if (res.locals.dashboardAdminMode) {
          dashboardUser.set("disallow_anonymous", req.body["disallow-anonymous"] === "on");
        }

        const dashboardUserDetails = dashboardUser.related("details");
        dashboardUserDetails.set("social_links", {
          website: req.body.website,
          twitter: forms.sanitizeString(req.body.twitter.replace("@", "")),
        });
        dashboardUserDetails.set("body", forms.sanitizeMarkdown(req.body.body,
          { maxLength: constants.MAX_BODY_USER_DETAILS }));
        await dashboardUserDetails.save();

        if (dashboardUser.hasChanged("title")) {
          await userService.refreshUserReferences(dashboardUser);
        }

        if (req.file || req.body["avatar-delete"]) {
          const avatarPath = "/user/" + dashboardUser.get("id");
          await fileStorage.savePictureToModel(dashboardUser, "avatar", req.file,
            req.body["avatar-delete"], avatarPath, { maxDiagonal: 500 });
        }

        await dashboardUser.save();
      }
    }
  }

  res.render("user/dashboard-settings", {
    errorMessage,
    infoMessage,
  });
}

/**
 * Manage user profile contents
 */
async function dashboardPassword(req, res) {
  let errorMessage = "";
  let infoMessage = "";

  if (req.method === "POST") {
    const dashboardUser = res.locals.dashboardUser;

    // Change password form
    if (!res.locals.dashboardAdminMode && !req.body.password) {
      errorMessage = "You must enter your current password";
    } else if (!res.locals.dashboardAdminMode
        && !await userService.authenticate(dashboardUser.get("name"), req.body.password)) {
      errorMessage = "Current password is incorrect";
    } else if (!req.body["new-password"]) {
      errorMessage = "You must enter a new password";
    } else if (req.body["new-password"] !== req.body["new-password-bis"]) {
      errorMessage = "New passwords do not match";
    } else {
      const result = userService.setPassword(dashboardUser, req.body["new-password"]);
      if (result !== true) {
        errorMessage = result;
      } else {
        await dashboardUser.save();
        infoMessage = "Password change successful";
      }
    }
  }

  res.render("user/dashboard-password", {
    errorMessage,
    infoMessage,
  });
}

async function dashboardEntryImport(req, res) {
  const context: any = {
    availableImporters: entryImportService.getAvailableImporters(),
  };

  if (req.method === "POST") {
    context.importer = forms.sanitizeString(req.body.importer);
    context.profileIdentifier = forms.sanitizeString(req.body.profileIdentifier);
    context.oauthIdentifier = forms.sanitizeString(req.body.oauthIdentifier);

    let entryIds = req.body.entries;
    if (!Array.isArray(entryIds)) {
      entryIds = entryIds ? [entryIds] : [];
    }

    const importerProfileIdentifier = context.profileIdentifier || context.oauthIdentifier;
    if (req.body.run) {
      try {
        let result;
        for (const entryId of entryIds) {
          result = await entryImportService.createOrUpdateEntry(res.locals.user, context.importer,
            importerProfileIdentifier, entryId);
          if (result.error) {
            throw new Error(result.error);
          }
        }
        context.infoMessage = "Successfully imported " + entryIds.length + " "
          + (entryIds.length === 1 ? "entry" : "entries") + "!";
      } catch (e) {
        context.errorMessage = "Error happened during entry import: " + e.message
          + ". Import may have been partially done, please check your Entries page.";
      }
    } else if (entryIds.length > 0) {
      context.errorMessage = "You must confirm the games are yours before importing them (see checkbox at the bottom).";
    }

    if (importerProfileIdentifier) {
      context.entryReferences = await entryImportService.fetchEntryReferences(
        res.locals.user, context.importer, importerProfileIdentifier);
    }
  }

  res.render("user/dashboard-entry-import", context);
}

/**
 * Register form
 */
async function registerForm(req, res) {
  res.locals.pageTitle = "Register";
  res.render("register");
}

/**
 * Register
 */
async function doRegister(req, res) {
  res.locals.pageTitle = "Register";

  let errorMessage = null;
  if (!(req.body.name && req.body.password && req.body.email)) {
    errorMessage = "A field is missing";
  } else if (!forms.isUsername(req.body.name)) {
    errorMessage = "Your usename is too weird (either too short,"
      + "or has special chars other than '_' or '-', or starts with a number)";
  } else if (req.body.password !== req.body["password-bis"]) {
    errorMessage = "Passwords do not match";
  } else if (!req.body.captcha || req.body.captcha.trim().toLowerCase()[0] !== "y") {
    errorMessage = "You didn't pass the human test!";
  } else {
    const result = await userService.register(req.body.email, req.body.name, req.body.password);
    if (typeof result === "string") {
      errorMessage = result;
    } else {
      doLogin(req, res);
    }
  }

  if (errorMessage) {
    req.body.errorMessage = errorMessage;
    res.render("register", req.body);
  }
}

/**
 * Login form
 */
async function loginForm(req, res) {
  res.locals.pageTitle = "Login";

  res.render("login", {
    redirect: forms.sanitizeString(req.query.redirect),
  });
}

/**
 * Login
 */
async function doLogin(req, res) {
  res.locals.pageTitle = "Login";

  const context: any = {
    redirect: forms.sanitizeString(req.body.redirect),
  };
  if (req.body.name && req.body.password) {
    const user = await userService.authenticate(req.body.name, req.body.password);
    if (user) {
      context.user = user;
      context.infoMessage = "Authentication successful";

      req.session.userId = user.get("id");
      if (req.body["remember-me"]) {
        req.session.cookie.maxAge = constants.REMEMBER_ME_MAX_AGE;
      }
      await req.session.savePromisified();
    } else {
      context.errorMessage = "Authentication failed";
    }
  } else {
    context.errorMessage = "Username or password missing";
  }

  if (!context.errorMessage && context.redirect) {
    res.redirect(context.redirect);
  } else {
    res.render("login", context);
  }
}

/**
 * Logout
 */
async function doLogout(req, res) {
  res.locals.pageTitle = "Login";

  await req.session.regeneratePromisified();
  res.locals.user = null;
  res.render("login", {
    infoMessage: "Logout successful.",
  });
}

async function passwordRecoveryRequest(req, res) {
  let errorMessage = null;

  if (res.locals.user) {
    res.redirect("/");
    return;
  }

  if (req.method === "POST") {
    if (!forms.isEmail(req.body.email)) {
      errorMessage = "Invalid email address";
    }

    if (!errorMessage) {
      try {
        await userService.sendPasswordRecoveryEmail(res.app, req.body.email);
        res.locals.success = true;
      } catch (err) {
        errorMessage = err.message;
      }
    }
  }

  res.render("password-recovery-request", {
    errorMessage,
  });
}

/**
 * Password change page, following the click on a password recovery link.
 */
async function passwordRecovery(req, res) {
  let errorMessage = null;

  if (res.locals.user) {
    res.redirect("/");
    return;
  }

  if (userService.validatePasswordRecoveryToken(res.app, req.query.token)) {
    res.locals.token = true;

    if (req.method === "POST") {
      if (!req.body["new-password"]) {
        errorMessage = "You must enter a new password";
      } else if (req.body["new-password"] !== req.body["new-password-bis"]) {
        errorMessage = "New passwords do not match";
      } else {
        const result = await userService.setPasswordUsingToken(res.app, req.query.token, req.body["new-password"]);
        if (result === true) {
          res.locals.success = true;
        } else {
          errorMessage = result;
        }
      }
    }
  }

  res.render("password-recovery", {
    errorMessage,
  });
}
