// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.2
// @description  Show account age, karma, custom tags, and author rating next to the username in Hacker News comment pages
// @author       You
// @match        https://news.ycombinator.com/item?id=*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

;(function () {
  'use strict'

  const getUsernameElements = () =>
    Array.from(document.querySelectorAll('.hnuser'))
  const getUsernames = () => getUsernameElements().map((el) => el.textContent)

  const fetchUserData = async (username) => {
    return new Promise((resolve, reject) => {
      // Asynchronously fetch Hacker News user data for the provided username
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
        onload: (response) => {
          if (response.status === 200) {
            resolve(JSON.parse(response.responseText));
          } else {
            reject(new Error('Error fetching user data'));
          }
        },
      });
    });
  };

  // Calculate the elapsed time since the given Unix timestamp
  // Returns a string representing the time difference in years, months or days
  const timeSince = (unixTimestamp) => {
    const seconds = Math.floor(new Date().getTime() / 1000 - unixTimestamp)
    const interval = Math.floor(seconds / 31536000)

    if (interval >= 1) {
      return interval + ' years'
    } else {
      const intervalMonths = Math.floor(seconds / 2592000)
      if (intervalMonths >= 1) {
        return intervalMonths + ' months'
      } else {
        const intervalDays = Math.floor(seconds / 86400)
        return intervalDays + ' days'
      }
    }
  }

  // New functions to handle author ratings
  const saveAuthorRating = (username, rating) => {
    GM_setValue(`hn_author_rating_${username}`, rating)
  }

  const loadAuthorRating = (username) => {
    return GM_getValue(`hn_author_rating_${username}`, 0)
  }

  // Create and return a rating control UI (up/down arrows and display)
  // for the specified username
  const createRatingControls = (username) => {
    const ratingContainer = document.createElement('span')
    ratingContainer.style.marginLeft = '4px'

    const upArrow = document.createElement('button')
    upArrow.textContent = '▲'
    upArrow.style.fontSize = '0.6em'
    upArrow.style.padding = '1px 2px'
    upArrow.style.marginRight = '2px'

    const downArrow = document.createElement('button')
    downArrow.textContent = '▼'
    downArrow.style.fontSize = '0.6em'
    downArrow.style.padding = '1px 2px'
    downArrow.style.marginRight = '2px'

    const ratingDisplay = document.createElement('span')
    ratingDisplay.textContent = loadAuthorRating(username)
    ratingDisplay.style.fontSize = '1.3em'
    ratingDisplay.style.padding = '0 4px 0 2px'
    ratingDisplay.style.color = '#575F94'
    ratingDisplay.style.fontWeight = '700'
    ratingDisplay.style.position = 'relative'
    ratingDisplay.style.top = '3px'

    upArrow.addEventListener('click', () => {
      const currentRating = parseInt(ratingDisplay.textContent, 10)
      const newRating = currentRating + 1
      saveAuthorRating(username, newRating)
      ratingDisplay.textContent = newRating
    })

    downArrow.addEventListener('click', () => {
      const currentRating = parseInt(ratingDisplay.textContent, 10)
      const newRating = currentRating - 1
      saveAuthorRating(username, newRating)
      ratingDisplay.textContent = newRating
    })

    ratingContainer.appendChild(upArrow)
    ratingContainer.appendChild(downArrow)
    ratingContainer.appendChild(ratingDisplay)

    return ratingContainer
  }

  // Existing functions for custom tags and color handling
  const saveTags = (username, tags) => {
    GM_setValue(`hn_custom_tags_${username}`, JSON.stringify(tags))
  }

  const loadTags = (username) => {
    return JSON.parse(GM_getValue(`hn_custom_tags_${username}`, '[]'))
  }

  const saveTagColor = (tag, bgColor, textColor) => {
    GM_setValue(
      `hn_custom_tag_color_${tag}`,
      JSON.stringify({ bgColor, textColor }),
    )
  }

  const loadTagColor = (tag) => {
    return JSON.parse(GM_getValue(`hn_custom_tag_color_${tag}`, '{}'))
  }

  // Create an input field for adding custom tags for the provided username
  const createTagInput = (username) => {
    const tags = loadTags(username)
    const input = document.createElement('input')
    input.type = 'text'
    input.value = tags.map((tag) => tag.value).join(', ')
    input.placeholder = 'Add tags (comma separated)'
    input.style.fontSize = '0.8em'
    input.style.marginLeft = '4px'
    input.style.width = '200px'
    input.addEventListener('change', () => {
      const newTags = input.value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
      const updatedTags = newTags.map((value) => {
        const existingTag = tags.find((tag) => tag.value === value)
        if (existingTag) {
          return existingTag
        } else {
          let tagColors = loadTagColor(value)
          if (!tagColors.bgColor || !tagColors.textColor) {
            const bgColor = randomLightColor()
            const textColor = getContrastColor(bgColor)
            tagColors = { bgColor, textColor }
            saveTagColor(value, bgColor, textColor)
          }
          return {
            value: value,
            bgColor: tagColors.bgColor,
            textColor: tagColors.textColor,
          }
        }
      })
      saveTags(username, updatedTags)
    })
    return input
  }

  const randomLightColor = () => {
    const randomInt = (min, max) =>
      Math.floor(Math.random() * (max - min + 1) + min)
    return `hsl(${randomInt(0, 359)}, ${randomInt(30, 100)}%, ${randomInt(
      75,
      95,
    )}%)`
  }

  // Given an HSL background color (as a string), returns a contrasting text color ('black' or 'white')
  // based on computed luminance
  const getContrastColor = (bgColor) => {
    const hslToRgb = (h, s, l) => {
      let r, g, b

      const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }

      if (s === 0) {
        r = g = b = l
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r = hueToRgb(p, q, h + 1 / 3)
        g = hueToRgb(p, q, h)
        b = hueToRgb(p, q, h - 1 / 3)
      }

      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
    }

    const getLuminance = (rgb) => {
      const r = rgb[0] / 255
      const g = rgb[1] / 255
      const b = rgb[2] / 255

      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)

      return (max + min) / 2
    }

    const hsl = bgColor.match(/\d+/g).map(Number)
    hsl[0] /= 360
    hsl[1] /= 100
    hsl[2] /= 100

    const rgb = hslToRgb(...hsl)
    const luminance = getLuminance(rgb)

    return luminance > 0.5 ? 'black' : 'white'
  }

  const createTagSpan = (tag) => {
    const tagSpan = document.createElement('span')
    tagSpan.textContent = tag.value
    tagSpan.style.backgroundColor = tag.bgColor
    tagSpan.style.color = tag.textColor
    tagSpan.style.padding = '2px 4px'
    tagSpan.style.marginLeft = '4px'
    tagSpan.style.borderRadius = '3px'
    tagSpan.style.fontSize = '0.8em'
    tagSpan.style.fontWeight = 'bold'

    return tagSpan
  }

  // Main function: Fetch user data and update the page by displaying account info, custom tags, and rating controls
  const displayAccountInfoAndTags = async () => {
    const usernameElements = getUsernameElements();
    const uniqueUsernames = [...new Set(getUsernames())];

    const userDataPromises = uniqueUsernames.map(fetchUserData);
    try {
      const userDataList = await Promise.all(userDataPromises);

      usernameElements.forEach((usernameEl) => {
        const username = usernameEl.textContent;
        const userData = userDataList.find((data) => data.id === username);

        if (userData) {
          const { created, karma } = userData;
          const ageSpan = document.createElement('span');
          ageSpan.textContent = `(${timeSince(created)} old, ${karma} karma)`;
        ageSpan.style.fontSize = '0.8em'
        ageSpan.style.marginLeft = '4px'

        usernameEl.parentNode.insertBefore(ageSpan, usernameEl.nextSibling)

        const tags = loadTags(username)
        tags.forEach((tag) => {
          const tagSpan = createTagSpan(tag)
          ageSpan.parentNode.insertBefore(tagSpan, ageSpan.nextSibling)
        })

        const tagInput = createTagInput(username)
        ageSpan.parentNode.insertBefore(tagInput, ageSpan.nextSibling)

        const ratingControls = createRatingControls(username)
        ageSpan.parentNode.insertBefore(ratingControls, ageSpan.nextSibling)
      }
    })
  }

  displayAccountInfoAndTags()
})()
