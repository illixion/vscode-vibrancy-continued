const {VerticalRefreshRateContext} = require('./displayconfig')
const electron = require('electron')
const process = require('process')

function sleep(duration) {
	return new Promise(resolve => setTimeout(resolve, duration));
}

function areBoundsEqual(left, right) {
	return left.height === right.height
		&& left.width === right.width
		&& left.x === right.x
		&& left.y === right.y;
}

const billion = 1000 * 1000 * 1000;

function hrtimeDeltaForFrequency(freq) {
	return BigInt(Math.ceil(billion / freq));
}

let disableJitterFix = false

// Detect if cursor is near the screen edge. Used to disable the jitter fix in 'move' event.
function isInSnapZone() {
	const point = electron.screen.getCursorScreenPoint()
	const display = electron.screen.getDisplayNearestPoint(point)

	// Check if cursor is near the left/right edge of the active display
	return (point.x > display.bounds.x - 20 && point.x < display.bounds.x + 20) || (point.x > display.bounds.x + display.bounds.width - 20 && point.x < display.bounds.x + display.bounds.width + 20);
}

/**
 * Unfortunately, we have to re-implement moving and resizing.
 * Enabling vibrancy slows down the window's event handling loop to the
 * point building a mouse event backlog. If you just handle these events
 * in the backlog without taking the time difference into consideration,
 * you end up with visible movement lag.
 * We tried pairing 'will-move' with 'move', but Electron actually sends the
 * 'move' events _before_ Windows actually commits to the operation. There's
 * likely some queuing going on that's getting backed up. This is not the case
 * with 'will-resize' and 'resize', which need to use the default behavior
 * for compatibility with soft DPI scaling.
 * The ideal rate of moving and resizing is based on the vertical sync
 * rate: if your display is only fully updating at 120 Hz, we shouldn't
 * be attempting to reset positions or sizes any faster than 120 Hz.
 * If we were doing this in a browser context, we would just use
 * requestAnimationFrame and call it a day. But we're not inside of a
 * browser context here, so we have to resort to clever hacks.
 * This VerticalRefreshRateContext maps a point in screen space to the
 * vertical sync rate of the display(s) actually handing that point.
 * It handles multiple displays with varying vertical sync rates,
 * and changes to the display configuration while this process is running.
 */
module.exports = function win10refresh(win, maximumRefreshRate) {
	if (!('__electron_acrylic_window__' in win)) {
		win.__electron_acrylic_window__ = {};
	}

	const refreshCtx = new VerticalRefreshRateContext()

	function getRefreshRateAtCursor(cursor) {
		cursor = cursor || electron.screen.getCursorScreenPoint()
		return refreshCtx.findVerticalRefreshRateForDisplayPoint(cursor.x, cursor.y)
	}

	// Ensure all movement operation is serialized, by setting up a continuous promise chain
	// All movement operation will take the form of
	//
	//     boundsPromise = boundsPromise.then(() => { /* work */ })
	//
	// So that there are no asynchronous race conditions.
	let pollingRate
	let doFollowUpQuery = false, isMoving = false, shouldMove = false
	let moveLastUpdate = BigInt(0), resizeLastUpdate = BigInt(0)
	let lastWillMoveBounds, lastWillResizeBounds,
		desiredMoveBounds
	let boundsPromise = Promise.race([
		getRefreshRateAtCursor(electron.screen.getCursorScreenPoint()).then(rate => {
			pollingRate = rate || 30
			doFollowUpQuery = true
		}),
		// Establishing the display configuration can fail; we can't
		// just block forever if that happens. Instead, establish
		// a fallback polling rate and hope for the best.
		sleep(2000).then(() => {
			pollingRate = pollingRate || 30
		})
	])

	async function doFollowUpQueryIfNecessary(cursor) {
		if (doFollowUpQuery) {
			const rate = await getRefreshRateAtCursor(cursor)
			if (rate != pollingRate) console.log(`New polling rate: ${rate}`)
			pollingRate = rate || 30
		}
	}

	function setWindowBounds(bounds) {
		if (win.isDestroyed()) return
		win.setBounds(bounds)
		desiredMoveBounds = win.getBounds()
	}

	function currentTimeBeforeNextActivityWindow(lastTime, forceFreq) {
		return process.hrtime.bigint() <
			lastTime + hrtimeDeltaForFrequency(forceFreq || pollingRate || 30)
	}

	function guardingAgainstMoveUpdate(fn) {
		if (pollingRate === undefined || !currentTimeBeforeNextActivityWindow(moveLastUpdate)) {
			moveLastUpdate = process.hrtime.bigint()
			fn()
			return true
		} else {
			return false
		}
	}

	// https://github.com/illixion/vscode-vibrancy-continued/issues/38#issuecomment-1320238352
	// win.on('will-move', (e, newBounds) => {
	// 	if (win.__electron_acrylic_window__.opacityInterval) return
	// 	// We get a _lot_ of duplicate bounds sent to us in this event.
	// 	// This messes up our timing quite a bit.
	// 	if (lastWillMoveBounds !== undefined && areBoundsEqual(lastWillMoveBounds, newBounds)) {
	// 		e.preventDefault()
	// 		return
	// 	}
	// 	if (lastWillMoveBounds) {
	// 		newBounds.width = lastWillMoveBounds.width
	// 		newBounds.height = lastWillMoveBounds.height
	// 	}
	// 	lastWillMoveBounds = newBounds
	// 	// If we're asked to perform some move update and it's under
	// 	// the refresh speed limit, we can just do it immediately.
	// 	// This also catches moving windows with the keyboard.
	// 	const didOptimisticMove = !isMoving && guardingAgainstMoveUpdate(() => {
	// 		// Do nothing, the default behavior of the event is exactly what we want.
	// 		desiredMoveBounds = undefined
	// 	})
	// 	if (didOptimisticMove) {
	// 		boundsPromise = boundsPromise.then(doFollowUpQueryIfNecessary)
	// 		return
	// 	}
	// 	e.preventDefault()

	// 	// Track if the user is moving the window
	// 	if (win.__electron_acrylic_window__.moveTimeout) clearTimeout(win.__electron_acrylic_window__.moveTimeout)
	// 	win.__electron_acrylic_window__.moveTimeout = setTimeout(() => {
	// 		shouldMove = false
	// 	}, 1000 / Math.min(pollingRate, maximumRefreshRate))

	// 	// Disable next event ('move') if cursor is near the screen edge
	// 	disableJitterFix = isInSnapZone()

	// 	// Start new behavior if not already
	// 	if (!shouldMove) {
	// 		shouldMove = true

	// 		if (isMoving) return false
	// 		isMoving = true

	// 		// Get start positions
	// 		const basisBounds = win.getBounds()
	// 		const basisCursor = electron.screen.getCursorScreenPoint()

	// 		// Handle polling at a slower interval than the setInterval handler
	// 		function handleIntervalTick(moveInterval) {
	// 			boundsPromise = boundsPromise.then(() => {
	// 				if (!shouldMove) {
	// 					isMoving = false
	// 					clearInterval(moveInterval)
	// 					return
	// 				}

	// 				const cursor = electron.screen.getCursorScreenPoint()
	// 				const didIt = guardingAgainstMoveUpdate(() => {
	// 					// Set new position
	// 					if (lastWillResizeBounds && lastWillResizeBounds.width) setWindowBounds({
	// 						x: Math.floor(basisBounds.x + (cursor.x - basisCursor.x)),
	// 						y: Math.floor(basisBounds.y + (cursor.y - basisCursor.y)),
	// 						width: Math.floor(lastWillResizeBounds.width / electron.screen.getDisplayMatching(basisBounds).scaleFactor),
	// 						height: Math.floor(lastWillResizeBounds.height / electron.screen.getDisplayMatching(basisBounds).scaleFactor)
	// 					})
	// 					else setWindowBounds({
	// 						x: Math.floor(basisBounds.x + (cursor.x - basisCursor.x)),
	// 						y: Math.floor(basisBounds.y + (cursor.y - basisCursor.y)),
	// 						width: Math.floor(lastWillMoveBounds.width / electron.screen.getDisplayMatching(basisBounds).scaleFactor),
	// 						height: Math.floor(lastWillMoveBounds.height / electron.screen.getDisplayMatching(basisBounds).scaleFactor)
	// 					})
	// 				})
	// 				if (didIt) {
	// 					return doFollowUpQueryIfNecessary(cursor)
	// 				}
	// 			})
	// 		}

	// 		// Poll at 600hz while moving window
	// 		const moveInterval = setInterval(() => handleIntervalTick(moveInterval), 1000 / 600)
	// 	}
	// })

	win.on('move', (e) => {
		if (isInSnapZone()) {
			return false
		}
		if (isMoving || win.isDestroyed()) {
			e.preventDefault()
			return false
		}
		// As insane as this sounds, Electron sometimes reacts to prior
		// move events out of order. Specifically, if you have win.setBounds()
		// twice, then for some reason, when you exit the move state, the second
		// call to win.setBounds() gets reverted to the first call to win.setBounds().
		//
		// Again, it's nuts. But what we can do in this circumstance is thwack the
		// window back into place just to spite Electron. Yes, there's a shiver.
		// No, there's not much we can do about it until Electron gets their act together.
		if (desiredMoveBounds !== undefined) {
			const forceBounds = desiredMoveBounds
			desiredMoveBounds = undefined
			win.setBounds({
				x: Math.floor(forceBounds.x),
				y: Math.floor(forceBounds.y),
				width: Math.floor(forceBounds.width),
				height: Math.floor(forceBounds.height)
			})
		}
	})

	win.on('will-resize', (e, newBounds) => {
		if (lastWillResizeBounds !== undefined && areBoundsEqual(lastWillResizeBounds, newBounds)) {
			e.preventDefault()
			return
		}

		lastWillResizeBounds = newBounds

		// 60 Hz ought to be enough... for resizes.
		// Some systems have trouble going 120 Hz, so we'll just take the lower
		// of the current pollingRate and 60 Hz.
		if (pollingRate !== undefined &&
			currentTimeBeforeNextActivityWindow(resizeLastUpdate, Math.min(pollingRate, maximumRefreshRate))) {
			e.preventDefault()
			return false
		}
		// We have to count this twice: once before the resize,
		// and once after the resize. We actually don't have any
		// timing control around _when_ the resize happened, so
		// we have to be pessimistic.
		resizeLastUpdate = process.hrtime.bigint()
	})

	win.on('resize', () => {
		resizeLastUpdate = process.hrtime.bigint()
		boundsPromise = boundsPromise.then(doFollowUpQueryIfNecessary)
	})

	// Close the VerticalRefreshRateContext so Node can exit cleanly
	win.on('closed', refreshCtx.close)
}
