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
    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment {
      padding-top: 10px;
    }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      grid-row: 1 / span 3;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tags-row {
      display: flex;
      align-items: center;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text {
      margin-right: 5px;
    }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover {
      background-color: rgba(255, 255, 255, 0.6);
    }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
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
	
	// Helper to find the correct parent for insertion
	const findCommentParent = (usernameEl) => {
		// Try to find comhead first
		const comhead = usernameEl.closest('.comhead');
		if (comhead) return comhead;
		
		// Fallback to direct parent
		return usernameEl.parentElement;
	};

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

		createTagSpan: (tag, username) => {
			const tagSpan = document.createElement("div");
			tagSpan.className = "hn-tag";
			tagSpan.style.backgroundColor = tag.bgColor;
			tagSpan.style.color = tag.textColor;

			// Tag text
			const tagText = document.createElement("span");
			tagText.textContent = tag.value;
			tagText.className = "hn-tag-text";
		
			// Icons container
			const iconsContainer = document.createElement("div");
			iconsContainer.className = "hn-tag-icons";
		
			// Edit icon
			const editIcon = document.createElement("span");
			editIcon.innerHTML = "✏️";
			editIcon.title = "Edit tag";
			editIcon.className = "hn-tag-icon";
			editIcon.addEventListener("click", (e) => {
				e.stopPropagation();
				const newName = prompt("Edit tag name:", tag.value);
				if (newName && newName !== tag.value) {
					// Get current tags
					const currentTags = storage.loadTags(username);
					// Update the specific tag
					const updatedTags = currentTags.map(t => 
						t.value === tag.value ? {...t, value: newName} : t
					);
					// Save updated tags
					storage.saveTags(username, updatedTags);
					// Refresh the display
					location.reload();
				}
			});
		
			// Remove icon
			const removeIcon = document.createElement("span");
			removeIcon.innerHTML = "✖";
			removeIcon.title = "Remove tag";
			removeIcon.className = "hn-tag-icon";
			removeIcon.addEventListener("click", (e) => {
				e.stopPropagation();
				if (confirm(`Remove tag "${tag.value}"?`)) {
					// Get current tags
					const currentTags = storage.loadTags(username);
					// Filter out the removed tag
					const updatedTags = currentTags.filter(t => t.value !== tag.value);
					// Save updated tags
					storage.saveTags(username, updatedTags);
					// Refresh the display
					location.reload();
				}
			});
		
			// Add icons to container
			iconsContainer.appendChild(editIcon);
			iconsContainer.appendChild(removeIcon);
		
			// Add text and icons to tag
			tagSpan.appendChild(tagText);
			tagSpan.appendChild(iconsContainer);

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

				if (!userData) continue; // Skip if no data available

				const { created, karma } = userData;
				
				// Find the right parent for insertion
				const parentElement = findCommentParent(usernameEl);
				if (!parentElement) continue;
				
				// Create the main layout container
				const layoutContainer = document.createElement("div");
				layoutContainer.className = "hn-post-layout";
				
				// Create main row for username, age/karma, rating, and tag input
				const mainRow = document.createElement("div");
				mainRow.className = "hn-main-row";
				
				// Create and append account info
				const ageSpan = ui.createAccountInfoSpan(created, karma);
				
				// Create rating controls
				const ratingControls = ui.createRatingControls(username);
				
				// Create tag input
				const tagInput = ui.createTagInput(username);
				
				// Add username element (clone it)
				const usernameClone = usernameEl.cloneNode(true);
				usernameClone.className += " hn-username";
				mainRow.appendChild(usernameClone);
				
				// Add account info, rating controls and tag input
				mainRow.appendChild(ageSpan);
				mainRow.appendChild(ratingControls);
				mainRow.appendChild(tagInput);
				
				// Add the main row to the layout container
				layoutContainer.appendChild(mainRow);
				
				// Create container for tags (right column)
				const tagContainer = document.createElement("div");
				tagContainer.className = "hn-tag-container";
				
				// Get all tags
				const tags = storage.loadTags(username);
				
				// Create a group for all tags
				const tagGroup = document.createElement("div");
				tagGroup.className = "hn-tag-group";
				
				// Add all tags vertically in the group
				for (let i = 0; i < tags.length; i++) {
					const tagSpan = ui.createTagSpan(tags[i], username);
					tagGroup.appendChild(tagSpan);
				}
				
				// Add tag group to container
				tagContainer.appendChild(tagGroup);
				
				// Add the tag container to the layout
				layoutContainer.appendChild(tagContainer);
				
				// Insert the layout after the parent element
				parentElement.parentNode.insertBefore(layoutContainer, parentElement.nextSibling);
				
				// Hide the original username to avoid duplication
				usernameEl.style.display = "none";
			}
		} catch (error) {
			console.error("Error in displayAccountInfoAndTags:", error);
		}
	};

	// State Management
	const stateManagement = {
		exportState: () => {
			// Create normalized data structure
			const exportData = {
				customTags: {},
				users: {}
			};
			
			// Get all unique tag definitions and users
			let allTagDefinitions = new Map();
			
			// Function to process user data
			const processUserData = (username) => {
				// Get user rating
				const rating = GM_getValue(`hn_author_rating_${username}`, 0);
				
				// Get user tags
				const tagsRaw = GM_getValue(`hn_custom_tags_${username}`, "[]");
				let tags = [];
				
				try {
					const parsedTags = JSON.parse(tagsRaw);
					
					// Add each tag to the global tag definitions if not already there
					parsedTags.forEach(tag => {
						const tagName = tag.value;
						
						// Add to tag definitions if not already there
						if (!allTagDefinitions.has(tagName)) {
							const tagColorData = GM_getValue(`hn_custom_tag_color_${tagName}`, "{}");
							let colorInfo;
							
							try {
								colorInfo = JSON.parse(tagColorData);
							} catch (e) {
								colorInfo = {
									bgColor: tag.bgColor || colorUtils.randomLightColor(),
									textColor: tag.textColor || "black"
								};
							}
							
							allTagDefinitions.set(tagName, {
								bgColor: colorInfo.bgColor,
								textColor: colorInfo.textColor
							});
						}
						
						// Add tag reference to user's tags
						tags.push(tagName);
					});
				} catch (e) {
					console.error(`Failed to parse tags for ${username}:`, e);
				}
				
				// Only add user if they have rating or tags
				if (rating !== 0 || tags.length > 0) {
					exportData.users[username] = {
						rating: rating,
						tags: tags
					};
				}
			};
			
			// Process all users from storage
			if (typeof GM_listValues === 'function') {
				const allKeys = GM_listValues();
				
				// First, find all user ratings and custom tags
				const userSet = new Set();
				
				for (const key of allKeys) {
					// Extract usernames from rating keys
					if (key.startsWith('hn_author_rating_')) {
						const username = key.replace('hn_author_rating_', '');
						userSet.add(username);
					}
					// Extract usernames from tag keys
					else if (key.startsWith('hn_custom_tags_')) {
						const username = key.replace('hn_custom_tags_', '');
						userSet.add(username);
					}
				}
				
				// Process each user
				userSet.forEach(username => {
					processUserData(username);
				});
				
				// Extract all tag colors for completeness
				for (const key of allKeys) {
					if (key.startsWith('hn_custom_tag_color_')) {
						const tagName = key.replace('hn_custom_tag_color_', '');
						
						// Only add if not already processed
						if (!allTagDefinitions.has(tagName)) {
							const tagColorData = GM_getValue(key, "{}");
							
							try {
								const colorInfo = JSON.parse(tagColorData);
								if (colorInfo.bgColor) {
									allTagDefinitions.set(tagName, {
										bgColor: colorInfo.bgColor,
										textColor: colorInfo.textColor || "black"
									});
								}
							} catch (e) {
								console.error(`Failed to parse tag color for ${tagName}:`, e);
							}
						}
					}
				}
			} else {
				// If GM_listValues is not available, use current page data
				console.warn("GM_listValues is not available. Export may be incomplete.");
				const usernames = getUsernames();
				
				for (const username of usernames) {
					processUserData(username);
				}
			}
			
			// Convert tag definitions Map to object
			allTagDefinitions.forEach((tagInfo, tagName) => {
				exportData.customTags[tagName] = tagInfo;
			});
			
			// Create a blob and trigger download
			const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
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
						const importedData = JSON.parse(e.target.result);
						
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
						
						// Handle both the new format and legacy format
						if (importedData.customTags && importedData.users) {
							// New format - Process tag definitions
							for (const [tagName, tagInfo] of Object.entries(importedData.customTags)) {
								GM_setValue(
									`hn_custom_tag_color_${tagName}`, 
									JSON.stringify({
										bgColor: tagInfo.bgColor,
										textColor: tagInfo.textColor
									})
								);
							}
							
							// Process user data
							for (const [username, userData] of Object.entries(importedData.users)) {
								// Save user rating
								GM_setValue(`hn_author_rating_${username}`, userData.rating);
								
								// Save user tags
								const userTags = userData.tags.map(tagName => {
									const tagInfo = importedData.customTags[tagName];
									return {
										value: tagName,
										bgColor: tagInfo?.bgColor || colorUtils.randomLightColor(),
										textColor: tagInfo?.textColor || 'black'
									};
								});
								
								GM_setValue(`hn_custom_tags_${username}`, JSON.stringify(userTags));
							}
						} else {
							// Legacy format - directly copy values
							for (const [key, value] of Object.entries(importedData)) {
								if (key.startsWith('hn_')) {
									GM_setValue(key, value);
								}
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

	// Remove <br/> tags before comments
	const removeBrBeforeComments = () => {
		const comments = document.querySelectorAll('div.comment');
		comments.forEach(comment => {
			const prevSibling = comment.previousSibling;
			if (prevSibling && prevSibling.nodeName === 'BR') {
				prevSibling.parentNode.removeChild(prevSibling);
			}
		});
	};

	// Initialize
	displayAccountInfoAndTags();
	createToolbar();
	removeBrBeforeComments();
})();
