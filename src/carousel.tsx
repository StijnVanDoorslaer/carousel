import deepEqual from 'deep-equal'
import {cpus} from 'os'
import {calc, listen, pointer, spring, styler, value} from 'popmotion'
import React, {
	FunctionComponent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react'
import {debounce} from 'throttle-debounce'
import {Lethargy} from './util/lethargy'

// Todo:
// https://www.w3.org/WAI/tutorials/carousels/structure/
// http://w3c.github.io/aria-practices/examples/carousel/carousel-1/carousel-1.html
// infinite scroll - lazy load - autoplay

type CarouselOptions = {
	snapTo?: 'elements' | 'pages'
	tug?: number
	power?: number
}

type IsActive = (page: number, childIndex: number) => boolean

type Carousel = {
	current: number
	setCurrent: (page: number) => void
	total: number
	setTotal: (amount: number) => void
	isActive: (childIndex: number) => boolean
	setIsActive: (update: () => IsActive) => void
} & CarouselOptions

type Snaps = {pages: Array<number>; elements: Array<number>}

export const useCarousel = (options?: CarouselOptions) => {
	const [current, setCurrent] = useState(0)
	const [total, setTotal] = useState(0)
	const isActiveRef = useRef<IsActive | null>(null)
	const isActive = (childIndex: number) => {
		if (isActiveRef.current) return isActiveRef.current(current, childIndex)
		return false
	}
	const setIsActive = (update: () => IsActive) =>
		(isActiveRef.current = update())
	const has = (index: number) => index >= 0 && index < total
	const hasNext = () => has(current + 1)
	const hasPrevious = () => has(current - 1)
	const goTo = (index: number) => {
		if (has(index)) setCurrent(index)
	}
	const goNext = () => goTo(current + 1)
	const goPrevious = () => goTo(current - 1)
	return {
		current,
		setCurrent,
		total,
		setTotal,
		has,
		hasNext,
		hasPrevious,
		goTo,
		goNext,
		goPrevious,
		isActive,
		setIsActive,
		...options
	}
}

const mix = calc.getValueFromProgress

const MY_RETINA_FIXING_MAGIC_NUMBER = 5

const calcSnaps = (dom: HTMLDivElement) => {
	const pageWidth = dom.offsetWidth
	const children = Array.from(
		(dom.firstChild! as HTMLDivElement).children
	) as Array<HTMLElement>
	return children.reduce<Snaps>(
		({pages, elements}, child, i) => {
			const prevPage = pages[pages.length - 1]
			const prevElement = elements[elements.length - 1]
			const width = child.offsetWidth
			const offset = prevElement + width
			elements.push(offset)
			if (
				prevElement > 0 &&
				offset - prevPage > pageWidth + MY_RETINA_FIXING_MAGIC_NUMBER
			)
				pages.push(prevElement)
			return {pages, elements}
		},
		{pages: [0], elements: [0]}
	)
}

const closest = (snaps: Array<number>, value: number) =>
	snaps.reduce((prev, curr) =>
		Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
	)

const angleIsVertical = (angle: number) => {
	const isUp = angle <= -90 + 45 && angle >= -90 - 45
	const isDown = angle <= 90 + 45 && angle >= 90 - 45
	return isUp || isDown
}

const snapToAnimation = (options: {
	from: number
	to: number
	velocity: number
}) => {
	return spring({
		...options,
		stiffness: 100,
		damping: 20
	})
}

export const Carousel: FunctionComponent<Carousel &
	CarouselOptions & {
		className?: string | {toString: () => string}
		full?: boolean
	}> = ({
	className,
	children,
	current,
	setCurrent,
	total,
	setTotal,
	setIsActive,
	snapTo = 'pages',
	tug = 0.4,
	power = 0.25,
	full = false
}) => {
	const dom = useRef<HTMLDivElement>(null)
	const offset = useMemo(() => value(0), [])
	const snapsRef = useRef<Snaps>({pages: [0], elements: [0]})
	const widthRef = useRef(0)
	const preventClick = useRef(false)
	const activePage = useRef(0)
	const options = {tug, power, snapTo}
	const optionsRef = useRef(options)

	const content = () => dom.current!.firstChild! as HTMLDivElement
	const max = () => content().scrollWidth - dom.current!.offsetWidth

	const update = useCallback((force?: boolean) => {
		const snaps = snapsRef.current
		const newSnaps = calcSnaps(dom.current!)
		if (!force && deepEqual(snaps, newSnaps)) return
		setTotal(Math.ceil(newSnaps.pages.length))
		snapsRef.current = newSnaps
		const {pages} = newSnaps
		// jump to current page
		spring(pages[activePage.current])
	}, [])

	const setActivePage = useCallback((destination: number) => {
		const {pages} = snapsRef.current
		const newPage =
			destination === max()
				? pages.length - 1
				: pages.indexOf(closest(pages, destination))
		activePage.current = newPage
		setCurrent(newPage)
	}, [])

	const spring = useCallback(
		(destination: number, animate = snapToAnimation) => {
			const from = offset.get() as number
			const to = -Math.min(destination, max())
			setActivePage(-to)
			if (from === to) return
			animate({from, to, velocity: offset.getVelocity()}).start(offset)
		},
		[]
	)

	const goTo = (pageIndex: number) => {
		const {pages} = snapsRef.current
		if (pageIndex < 0) return
		if (pageIndex > total - 1) return
		spring(pages[pageIndex])
	}

	// on update
	useEffect(() => {
		const pageWidth = dom.current!.offsetWidth
		const pageChange = activePage.current !== current
		widthRef.current = pageWidth
		activePage.current = current
		optionsRef.current = {tug, power, snapTo}
		update(pageChange)
	})

	// on create
	useEffect(() => {
		const contentStyler = styler(content())
		const clearSubscription = offset.subscribe((offset: number) => {
			contentStyler.set('x', offset)
		}).unsubscribe

		const snapToPoint = (start: number) => {
			const {snapTo} = optionsRef.current
			const snaps = snapsRef.current[snapTo]
			const from = offset.get() as number
			const velocity = offset.getVelocity()
			const distance = from - start
			const amplitude = power * velocity
			const idealTarget = Math.round(from + amplitude)
			const snap = closest(snaps, -idealTarget)
			preventClick.current = Math.abs(distance) > 1
			spring(snap)
		}

		let clearTrack = () => {}

		const overDrag = (v: number) => {
			const from = -max()
			const to = 0
			if (v < from) return mix(from, v, tug)
			if (v > to) return mix(to, v, tug)
			return v
		}

		const clearMove = listen(dom.current!, 'mousedown touchstart').start(
			(event: MouseEvent | TouchEvent) => {
				const start = offset.get() as number
				if (event instanceof MouseEvent && event.which !== 1) return
				preventClick.current = false
				clearTrack = pointer({
					x: start,
					preventDefault: false
				})
					.pipe((pos: {x: number}) => pos.x, overDrag)
					.start(offset).stop
				listen(document, 'mouseup touchend', {once: true}).start(() =>
					snapToPoint(start)
				)
			}
		).stop

		const onClick = (e: MouseEvent) => {
			if (!preventClick.current) return clearTrack()
			e.stopPropagation()
			e.preventDefault()
		}

		const lethargy = new Lethargy()
		let wheelPanning = false

		const onWheel = (e: MouseWheelEvent) => {
			const angle = calc.angle({
				x: e.deltaX,
				y: e.deltaY
			})
			const direction = lethargy.check(e.deltaX)
			if (angleIsVertical(angle)) return
			e.stopPropagation()
			e.preventDefault()
			if (direction === false) return
			if (wheelPanning) return
			goTo(current + direction)
			wheelPanning = true
			setTimeout(() => (wheelPanning = false), 500)
		}

		dom.current!.addEventListener('click', onClick, true)
		const clearClick = () =>
			dom.current!.removeEventListener('click', onClick, true)

		dom.current!.addEventListener('wheel', onWheel)
		const clearWheel = () => dom.current!.removeEventListener('wheel', onWheel)

		const onResize = debounce(250, () => update())

		window.addEventListener('resize', onResize)
		const clearResize = () => window.removeEventListener('resize', onResize)

		setIsActive(() => (current: number, childIndex: number) => {
			const {pages, elements} = snapsRef.current
			const pos = elements[childIndex]
			const next = elements[childIndex + 1]
			const page = pages[current]
			const nextPage = pages[current + 1] || Infinity
			return pos >= page && next - MY_RETINA_FIXING_MAGIC_NUMBER <= nextPage
		})

		return () => {
			clearSubscription()
			clearMove()
			clearTrack()
			clearClick()
			clearWheel()
			onResize.cancel()
			clearResize()
		}
	}, [])

	return (
		<div
			ref={dom}
			style={{
				overflow: full ? undefined : 'hidden',
				height: '100%',
				width: '100%',
				userSelect: 'none',
				touchAction: 'pan-y pinch-zoom'
			}}
			className={className && String(className)}
		>
			<div
				style={{height: '100%', display: 'flex'}}
				onDragStart={e => e.preventDefault()}
			>
				{children}
			</div>
		</div>
	)
}
