'use strict'

/**
 * Service for managing theme voting.
 *
 * @module services/event-theme-service
 */

const models = require('../core/models')
const constants = require('../core/constants')
const log = require('../core/log')
const forms = require('../core/forms')
const cache = require('../core/cache')
const settingService = require('./setting-service')

module.exports = {
  findThemeIdeasByUser,
  saveThemeIdeas,

  findThemeVotesHistory,
  findThemesToVoteOn,
  saveVote,

  findBestThemes
}

/**
 * Saves the theme ideas of an user for an event
 * @param user {User} user model
 * @param event {Event} event model
 * @param ideas {array(object)} An array of exactly 3 ideas (all fields optional): [{label, id}]
 */
async function findThemeIdeasByUser (user, event) {
  return models.Theme.where({
    user_id: user.get('id'),
    event_id: event.get('id')
  }).fetchAll()
}

/**
 * Saves the theme ideas of an user for an event
 * @param user {User} user model
 * @param event {Event} event model
 * @param ideas {array(object)} An array of exactly 3 ideas: [{title, id}]. Not filling the title
 * deletes the idea, not filling the ID creates one instead of updating it.
 */
async function saveThemeIdeas (user, event, ideas) {
  if (ideas.length !== 3) {
    throw new Error('there must be information for exactly 3 theme ideas')
  }

  let tasks = []

  // Run through all existing themes for that event/user combination
  let existingThemes = await findThemeIdeasByUser(user, event)
  let handledThemes = []
  for (let idea of ideas) {
    if (idea.id) {
      let existingTheme = existingThemes.findWhere({'id': parseInt(idea.id)})
      // We can only delete/update themes if they're active or cancelled because they're duplicates
      if (existingTheme && (existingTheme.get('status') === constants.THEME_STATUS_ACTIVE ||
          existingTheme.get('status') === constants.THEME_STATUS_DUPLICATE)) {
        if (idea.title) {
          // Update existing theme if needed
          if (idea.title !== existingTheme.get('title')) {
            existingTheme.set({
              title: idea.title,
              status: constants.THEME_STATUS_ACTIVE,
              score: 0,
              notes: 0,
              reports: 0
            })
            await handleDuplicates(existingTheme)
            tasks.push(existingTheme.save())
          }
        } else {
          // Delete existing theme
          tasks.push(existingTheme.destroy())
        }
        handledThemes.push(existingTheme)
      } else {
        log.warn('Invalid theme ID for user ' + user.get('name') + ': ' + idea.id)
        idea.id = null
      }
    }

    if (!idea.id && idea.title) {
      // Create theme
      let theme = new models.Theme({
        user_id: user.get('id'),
        event_id: event.get('id'),
        title: idea.title,
        status: constants.THEME_STATUS_ACTIVE
      })
      await handleDuplicates(theme)
      tasks.push(theme.save())
    }
  }

  // Destroy any theme not among the ideas
  let missingThemes = existingThemes.difference(handledThemes)
  if (missingThemes.length > 0) {
    log.warn('Theme ID were not given among the parameters for user ' + user.get('name') + ':')
    for (let missingTheme of missingThemes) {
      log.warn(' - ' + missingTheme.get('id'))
      tasks.push(missingTheme.destroy())
    }
  }

  await Promise.all(tasks)
  _refreshEventThemeStats(event)
}

/**
 * Sets the theme status to "duplicate" if another theme is identical
 */
async function handleDuplicates (theme) {
  theme.set('slug', forms.slug(theme.get('title')))

  let query = models.Theme.where({
    slug: theme.get('slug'),
    event_id: theme.get('event_id')
  })
  if (theme.get('id')) {
    query = query.where('id', '<>', theme.get('id'))
  }
  if ((await query.fetch()) !== null) {
    theme.set('status', constants.THEME_STATUS_DUPLICATE)
  }
}

/**
 * Returns the 30 latest votes by the user
 * @param user {User} user model
 * @param event {Event} event model
 * @param options {object} (optional) count
 */
async function findThemeVotesHistory (user, event, options = {}) {
  let query = models.ThemeVote.where({
    event_id: event.get('id'),
    user_id: user.get('id')
  })
  if (options.count) {
    return query.count()
  } else {
    return query.orderBy('id', 'DESC')
      .fetchPage({
        pageSize: 30,
        withRelated: ['theme']
      })
  }
}

/**
 * Returns a page of 10 themes that a user can vote on
 * @param user {User} (optional) user model
 * @param event {Event} event model
 */
async function findThemesToVoteOn (user, event) {
  let query = models.Theme
  if (user) {
    query = query.query(function (qb) {
      qb.leftOuterJoin('theme_vote', function () {
        this.on('theme.id', '=', 'theme_vote.theme_id')
        this.andOn('theme_vote.user_id', '=', user.get('id'))
      })
    })
    .where({
      status: constants.THEME_STATUS_ACTIVE,
      'theme.event_id': event.get('id'),
      'theme_vote.user_id': null
    })
    .where('theme.user_id', '<>', user.get('id'))
  } else {
    query = query.where('event_id', event.get('id'))
  }
  return query.orderBy('notes')
      .fetchPage({ pageSize: 10 })
}

/**
 * Saves a theme vote
 * @param user {User} user model
 * @param event {Event} event model
 * @param themeId {integer}
 * @param score {integer}
 */
async function saveVote (user, event, themeId, score) {
  let voteCreated = false
  let expectedStatus = null

  if (event.get('status_theme') === 'voting' && [-1, 1].indexOf(score) !== -1) {
    expectedStatus = 'active'
  } else if (event.get('status_theme') === 'shortlist' && score >= 1 && score <= 10) {
    expectedStatus = 'shortlist'
  }

  if (expectedStatus) {
    let theme = await models.Theme.where('id', themeId).fetch()

    if (theme.get('status') === expectedStatus) {
      let vote = await models.ThemeVote.where({
        user_id: user.get('id'),
        event_id: event.get('id'),
        theme_id: themeId
      }).fetch()

      if (vote) {
        theme.set('score', theme.get('score') + score - (vote.get('score') || 0))
        vote.set('score', score)
      } else {
        theme.set({
          'score': theme.get('score') + score,
          'notes': theme.get('notes') + 1
        })
        vote = new models.ThemeVote({
          theme_id: themeId,
          user_id: user.get('id'),
          event_id: event.get('id'),
          score: score
        })
        voteCreated = true
      }

      await Promise.all([theme.save(), vote.save()])
      _refreshEventThemeStats(event)
    }
  }

  if (voteCreated) {
    // Eliminate a theme every x votes. No need for DB transactions, just count in-memory
    let eliminationThreshold = parseInt(await settingService.find(constants.SETTING_EVENT_THEME_ELIMINATION_MODULO, '10'))
    let uptimeVotes = cache.general.get('uptime_votes') || 0
    uptimeVotes++
    if (uptimeVotes % eliminationThreshold === 0) {
      _eliminateLowestTheme(event)
    }
    cache.general.set('uptime_votes', uptimeVotes)
  }
}

async function _eliminateLowestTheme (event) {
  let eliminationMinNotes = parseInt(await settingService.find(constants.SETTING_EVENT_THEME_ELIMINATION_MIN_NOTES, '5'))

  let battleReadyThemesQuery = await models.Theme.where({
    event_id: event.get('id'),
    status: 'active'
  })
    .where('notes', '>=', eliminationMinNotes)

  // Make sure we have at least enough themes to fill our shortlist before removing one
  if (await battleReadyThemesQuery.count() > 10) {
    let loserTheme = await battleReadyThemesQuery
      .orderBy('score')
      .orderBy('created_at')
      .fetch()
    loserTheme.set('status', 'out')
    await loserTheme.save()
  }
}

async function findBestThemes (event, options) {
  let query = models.Theme.where({
    event_id: event.get('id')
  }).orderBy('score', 'DESC')
  if (options.fetchAll) {
    return query.fetchAll()
  } else {
    return query.fetchPage({ pageSize: 10 })
  }
}

async function _refreshEventThemeStats (event) {
  await event.load('details')
  let eventDetails = event.related('details')

  // Throttled: updates every 5 seconds max
  if (eventDetails.get('updated_at') < new Date().getTime() - 5000) {
    eventDetails.set('theme_count',
      await models.Theme.where({
        event_id: event.get('id')
      }).count())
    eventDetails.set('active_theme_count',
      await models.Theme.where({
        event_id: event.get('id'),
        status: 'active'
      }).count())
    eventDetails.set('theme_vote_count',
      await models.ThemeVote.where({
        event_id: event.get('id')
      }).count())
    eventDetails.save()
  }
}
