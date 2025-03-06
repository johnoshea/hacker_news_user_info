// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.3
// @description  Show account age, karma, custom tags, and author rating next to the username in Hacker News comment pages
// @author       You
// @match        https://news.ycombinator.com/item?id=*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_deleteValue
// ==/UserScript==

(() => {
	// Add styles to keep them separate from DOM manipulation
	GM_addStyle(`
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
    }
    .hn-tag {
      padding: 2px 4px;
      margin-left: 4px;
      border-radius: 3px;
      font-size: 0.8em;
      font-weight: bold;
    }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 200px;
    }
    .hn-rating-container {
      margin-left: 4px;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
      position: relative;
      top: 3px;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid #ff6600;
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
    }
    .hn-toolbar-btn {
      background-color: #ff6600;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover {
      background-color: #ff8533;
    }
  `);

	// Cache for user data to prevent duplicate API calls
	const userDataCache = new Map();

	// DOM Selectors
	const getUsernameElements = () =>
		Array.from(document.querySelectorAll(".hnuser"));
	const getUsernames = () => getUsernameElements().map((el) => el.textContent);

	// API Data Handling
	const fetchUserData = async (username) => {
		// Return cached data if available
		if (userDataCache.has(username)) {
			return userDataCache.get(username);
		}

		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
				onload: (response) => {
					if (response.status === 200 && response.responseText) {
						try {
							const data = JSON.parse(response.responseText);
							userDataCache.set(username, data);
							resolve(data);
						} catch (err) {
							reject(new Error(`Failed to parse response: ${err.message}`));
						}
					} else {
						reject(new Error(`Error fetching user data: ${response.status}`));
					}
				},
				onerror: (error) => {
					reject(
						new Error(`Request failed: ${error.statusText || "Unknown error"}`),
					);
				},
				ontimeout: () => {
					reject(new Error("Request timed out"));
				},
			});
		});
	};

	// Time Formatting
	const timeSince = (unixTimestamp) => {
		const seconds = Math.floor(new Date().getTime() / 1000 - unixTimestamp);
		const interval = Math.floor(seconds / 31536000);

		if (interval >= 1) {
			return `${interval} year${interval === 1 ? "" : "s"}`;
		}

		const intervalMonths = Math.floor(seconds / 2592000);
		if (intervalMonths >= 1) {
			return `${intervalMonths} month${intervalMonths === 1 ? "" : "s"}`;
		}

		const intervalDays = Math.floor(seconds / 86400);
		return `${intervalDays} day${intervalDays === 1 ? "" : "s"}`;
	};

	// Storage Helpers
	const storage = {
		// Author Ratings
		saveAuthorRating: (username, rating) => {
			GM_setValue(`hn_author_rating_${username}`, rating);
		},

		loadAuthorRating: (username) => {
			return GM_getValue(`hn_author_rating_${username}`, 0);
		},

		// Tags
		saveTags: (username, tags) => {
			GM_setValue(`hn_custom_tags_${username}`, JSON.stringify(tags));
		},

		loadTags: (username) => {
			try {
				return JSON.parse(GM_getValue(`hn_custom_tags_${username}`, "[]"));
			} catch (e) {
				console.error("Failed to parse tags:", e);
				return [];
			}
		},

		// Tag Colors
		saveTagColor: (tag, bgColor, textColor) => {
			GM_setValue(
				`hn_custom_tag_color_${tag}`,
				JSON.stringify({ bgColor, textColor }),
			);
		},

		loadTagColor: (tag) => {
			try {
				return JSON.parse(GM_getValue(`hn_custom_tag_color_${tag}`, "{}"));
			} catch (e) {
				console.error("Failed to parse tag color:", e);
				return {};
			}
		},
	};

	// Color Utilities
	const colorUtils = {
		randomLightColor: () => {
			const randomInt = (min, max) =>
				Math.floor(Math.random() * (max - min + 1) + min);
			return `hsl(${randomInt(0, 359)}, ${randomInt(30, 100)}%, ${randomInt(75, 95)}%)`;
		},

		getContrastColor: (bgColor) => {
			const hslToRgb = (h, s, l) => {
				let r;
				let g;
				let b;

				const hueToRgb = (p, q, t) => {
					let tValue = t;
					if (tValue < 0) tValue += 1;
					if (tValue > 1) tValue -= 1;
					if (tValue < 1 / 6) return p + (q - p) * 6 * tValue;
					if (tValue < 1 / 2) return q;
					if (tValue < 2 / 3) return p + (q - p) * (2 / 3 - tValue) * 6;
					return p;
				};

				if (s === 0) {
					r = g = b = l;
				} else {
					const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
					const p = 2 * l - q;
					r = hueToRgb(p, q, h + 1 / 3);
					g = hueToRgb(p, q, h);
					b = hueToRgb(p, q, h - 1 / 3);
				}

				return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
			};

			const getLuminance = (rgb) => {
				const r = rgb[0] / 255;
				const g = rgb[1] / 255;
				const b = rgb[2] / 255;

				const max = Math.max(r, g, b);
				const min = Math.min(r, g, b);

				return (max + min) / 2;
			};

			// Extract HSL values from string
			const hslMatch = bgColor.match(/\d+/g);
			if (!hslMatch || hslMatch.length < 3) {
				return "black"; // Default to black if parsing fails
			}

			const hsl = hslMatch.map(Number);
			hsl[0] /= 360;
			hsl[1] /= 100;
			hsl[2] /= 100;

			const rgb = hslToRgb(...hsl);
			const luminance = getLuminance(rgb);

			return luminance > 0.5 ? "black" : "white";
		},
	};

	// UI Components
	const ui = {
		createRatingControls: (username) => {
			const ratingContainer = document.createElement("span");
			ratingContainer.className = "hn-rating-container";

			const upArrow = document.createElement("button");
			upArrow.textContent = "▲";
			upArrow.className = "hn-rating-btn";

			const downArrow = document.createElement("button");
			downArrow.textContent = "▼";
			downArrow.className = "hn-rating-btn";

			const ratingDisplay = document.createElement("span");
			ratingDisplay.textContent = storage.loadAuthorRating(username);
			ratingDisplay.className = "hn-rating-display";

			// Prevent focus on buttons so spacebar doesn't trigger them
			upArrow.tabIndex = -1;
			downArrow.tabIndex = -1;

			upArrow.addEventListener("click", (e) => {
				e.preventDefault();
				// Explicitly blur to remove focus after click
				upArrow.blur();
				const currentRating = Number.parseInt(ratingDisplay.textContent, 10);
				const newRating = currentRating + 1;
				storage.saveAuthorRating(username, newRating);
				ratingDisplay.textContent = newRating;
			});

			downArrow.addEventListener("click", (e) => {
				e.preventDefault();
				// Explicitly blur to remove focus after click
				downArrow.blur();
				const currentRating = Number.parseInt(ratingDisplay.textContent, 10);
				const newRating = currentRating - 1;
				storage.saveAuthorRating(username, newRating);
				ratingDisplay.textContent = newRating;
			});

			ratingContainer.append(upArrow, downArrow, ratingDisplay);
			return ratingContainer;
		},

		createTagInput: (username) => {
			const tags = storage.loadTags(username);
			const input = document.createElement("input");
			input.type = "text";
			input.value = tags.map((tag) => tag.value).join(", ");
			input.placeholder = "Add tags (comma separated)";
			input.className = "hn-tag-input";

			// Debounce function to limit the frequency of updates
			let debounceTimeout;
			const handleTagChange = () => {
				clearTimeout(debounceTimeout);
				debounceTimeout = setTimeout(() => {
					const newTags = input.value
						.split(",")
						.map((tag) => tag.trim())
						.filter((tag) => tag.length > 0);

					const updatedTags = newTags.map((value) => {
						const existingTag = tags.find((tag) => tag.value === value);
						if (existingTag) {
							return existingTag;
						}

						let tagColors = storage.loadTagColor(value);
						if (!tagColors.bgColor || !tagColors.textColor) {
							const bgColor = colorUtils.randomLightColor();
							const textColor = colorUtils.getContrastColor(bgColor);
							const updatedTagColors = { bgColor, textColor };
							storage.saveTagColor(value, bgColor, textColor);
							tagColors = updatedTagColors;
						}
						return {
							value,
							bgColor: tagColors.bgColor,
							textColor: tagColors.textColor,
						};
					});

					storage.saveTags(username, updatedTags);
				}, 500); // 500ms debounce
			};

			input.addEventListener("change", handleTagChange);
			input.addEventListener("input", handleTagChange);

			return input;
		},

		createTagSpan: (tag) => {
			const tagSpan = document.createElement("span");
			tagSpan.textContent = tag.value;
			tagSpan.className = "hn-tag";
			tagSpan.style.backgroundColor = tag.bgColor;
			tagSpan.style.color = tag.textColor;

			return tagSpan;
		},

		createAccountInfoSpan: (created, karma) => {
			const ageSpan = document.createElement("span");
			ageSpan.textContent = `(${timeSince(created)} old, ${karma} karma)`;
			ageSpan.className = "hn-info";

			return ageSpan;
		},
	};

	// Main functionality
	const displayAccountInfoAndTags = async () => {
		const usernameElements = getUsernameElements();
		const uniqueUsernames = [...new Set(getUsernames())];

		try {
			// Fetch all user data in parallel
			const userDataPromises = uniqueUsernames.map((username) =>
				fetchUserData(username).catch((err) => {
					console.error(`Error fetching data for ${username}:`, err);
					return null; // Return null instead of rejecting to allow other requests to complete
				}),
			);

			const userDataList = await Promise.all(userDataPromises);
			const userDataMap = new Map();

			// Create a map for faster lookups
			for (const data of userDataList) {
				if (data?.id) {
					userDataMap.set(data.id, data);
				}
			}

			// Update the DOM
			for (const usernameEl of usernameElements) {
				const username = usernameEl.textContent;
				const userData = userDataMap.get(username);

				if (!userData) return; // Skip if no data available

				const { created, karma } = userData;

				// Create a document fragment to minimize DOM operations
				const fragment = document.createDocumentFragment();

				// Add account info
				const ageSpan = ui.createAccountInfoSpan(created, karma);
				fragment.appendChild(ageSpan);

				// Add rating controls
				const ratingControls = ui.createRatingControls(username);
				fragment.appendChild(ratingControls);

				// Add tag input
				const tagInput = ui.createTagInput(username);
				fragment.appendChild(tagInput);

				// Add existing tags
				const tags = storage.loadTags(username);
				for (const tag of tags) {
					const tagSpan = ui.createTagSpan(tag);
					fragment.appendChild(tagSpan);
				}

				// Insert all elements at once
				usernameEl.parentNode.insertBefore(fragment, usernameEl.nextSibling);
			}
		} catch (error) {
			console.error("Error in displayAccountInfoAndTags:", error);
		}
	};

	// State Management
	const stateManagement = {
		exportState: () => {
			// Get all stored data
			const data = {};
			
			// Export stored data
			if (typeof GM_listValues === 'function') {
				const allKeys = GM_listValues();
				for (const key of allKeys) {
					// Only export our script's data
					if (key.startsWith('hn_')) {
						data[key] = GM_getValue(key);
					}
				}
			} else {
				// If GM_listValues is not available
				// Get all usernames from the page and manually include their data
				const usernames = getUsernames();
				for (const username of usernames) {
					// Author ratings
					const ratingKey = `hn_author_rating_${username}`;
					data[ratingKey] = GM_getValue(ratingKey, 0);
					
					// Tags
					const tagsKey = `hn_custom_tags_${username}`;
					const tagsValue = GM_getValue(tagsKey, "[]");
					data[tagsKey] = tagsValue;
					
					// Get tag colors for all tags
					try {
						const tags = JSON.parse(tagsValue);
						for (const tag of tags) {
							const tagColorKey = `hn_custom_tag_color_${tag.value}`;
							data[tagColorKey] = GM_getValue(tagColorKey, "{}");
						}
					} catch (e) {
						console.error("Failed to parse tags:", e);
					}
				}
				
				console.warn("GM_listValues is not available. Export may be incomplete.");
			}
			
			// Create a blob and trigger download
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			
			// Create a link element and trigger a click
			const a = document.createElement('a');
			a.href = url;
			a.download = `hn-user-data-${new Date().toISOString().split('T')[0]}.json`;
			document.body.appendChild(a);
			a.click();
			
			// Clean up
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 100);
		},
		
		importState: () => {
			// Create a file input element
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			
			input.onchange = (event) => {
				const file = event.target.files[0];
				if (!file) return;
				
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = JSON.parse(e.target.result);
						
						// Clear existing data if GM_listValues is available
						if (typeof GM_listValues === 'function') {
							const allKeys = GM_listValues();
							for (const key of allKeys) {
								if (key.startsWith('hn_')) {
									if (typeof GM_deleteValue === 'function') {
										GM_deleteValue(key);
									}
								}
							}
						}
						
						// Import new data
						for (const [key, value] of Object.entries(data)) {
							if (key.startsWith('hn_')) {
								GM_setValue(key, value);
							}
						}
						
						// Refresh the page to show the new data
						alert('Data imported successfully! The page will now reload.');
						location.reload();
					} catch (error) {
						alert(`Error importing data: ${error.message}`);
						console.error('Error importing data:', error);
					}
				};
				
				reader.readAsText(file);
			};
			
			// Trigger file selection
			input.click();
		}
	};

	// Toolbar UI
	const createToolbar = () => {
		const toolbar = document.createElement('div');
		toolbar.className = 'hn-toolbar';
		
		const saveButton = document.createElement('button');
		saveButton.textContent = 'Save state';
		saveButton.className = 'hn-toolbar-btn';
		saveButton.addEventListener('click', stateManagement.exportState);
		
		const restoreButton = document.createElement('button');
		restoreButton.textContent = 'Restore state';
		restoreButton.className = 'hn-toolbar-btn';
		restoreButton.addEventListener('click', stateManagement.importState);
		
		toolbar.append(saveButton, restoreButton);
		document.body.appendChild(toolbar);
	};

	// Initialize
	displayAccountInfoAndTags();
	createToolbar();
})();
