'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Subject {
  id: string
  name: string
}

interface Institution {
  id: string
  name: string
}

interface Question {
  id: string
  statement: string
  subject_id: string
  subjects: { name: string } | null
}

interface SimulationQuestionRef {
  question_id: string
  section_part: number
  question_order: number | null
}

interface Simulation {
  id: string
  title: string
  description: string | null
  type: 'corto' | 'normal_jornadas' | 'tesoro'
  duration_minutes_part1: number
  duration_minutes_part2: number
  allowed_roles: string[]
  calendar: string
  academic_year: number
  target_institution_id: string | null
  is_active: boolean
  is_treasure_active: boolean
  created_at: string
  institutions?: { name: string } | null
  simulation_questions?: SimulationQuestionRef[]
}

interface QuestionDetail {
  statement: string
  image_url: string | null
  options: {
    id: string
    option_letter: string
    option_text: string | null
    option_image_url: string | null
    is_correct: boolean
  }[]
}

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2]

// Tipos de suscripción válidos según el ENUM en Supabase
const VALID_SUBSCRIPTIONS = ['simulacro_unico', 'preicfes_completo']

// Columnas que se leen de simulaciones (incluye question_order para conservar el orden)
const SIMULATIONS_SELECT =
  '*, institutions(name), simulation_questions(question_id, section_part, question_order)'

// ---------------------------------------------------------------------------
// Componentes auxiliares (fuera del componente principal)
// ---------------------------------------------------------------------------

function QuestionDetailView({
  detail,
  resolveUrl,
}: {
  detail?: QuestionDetail | 'error'
  resolveUrl: (value: string | null) => string | null
}) {
  if (!detail) return <p className="text-xs text-slate-500 p-3">Cargando pregunta...</p>
  if (detail === 'error')
    return <p className="text-xs text-rose-400 p-3">No se pudo cargar la pregunta.</p>

  const mainImage = resolveUrl(detail.image_url)

  return (
    <div className="p-3 space-y-2 bg-slate-900/60 rounded-xl text-xs border border-slate-800">
      <p className="text-slate-200 whitespace-pre-wrap">{detail.statement}</p>
      {mainImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mainImage}
          alt="Imagen de la pregunta"
          className="max-h-64 rounded-lg border border-slate-800"
        />
      )}
      <ul className="space-y-1">
        {[...(detail.options || [])]
          .sort((a, b) => a.option_letter.localeCompare(b.option_letter))
          .map((o) => {
            const optImg = resolveUrl(o.option_image_url)
            return (
              <li
                key={o.id}
                className={`flex items-start gap-2 ${
                  o.is_correct ? 'text-emerald-400 font-bold' : 'text-slate-300'
                }`}
              >
                <span className="shrink-0">{o.option_letter}.</span>
                <span>
                  {o.option_text}
                  {optImg && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={optImg} alt="" className="max-h-32 mt-1 rounded" />
                  )}
                  {o.is_correct && ' ✓ (correcta)'}
                </span>
              </li>
            )
          })}
      </ul>
    </div>
  )
}

interface SelectedListProps {
  part: 1 | 2
  ids: string[]
  accent: 'orange' | 'amber'
  questionsById: Map<string, Question>
  expandedIds: string[]
  details: Record<string, QuestionDetail | 'error'>
  resolveUrl: (value: string | null) => string | null
  onToggleExpand: (id: string) => void
  onMove: (part: 1 | 2, from: number, to: number) => void
  onRemove: (id: string, part: 1 | 2) => void
}

function SelectedQuestionsList({
  part,
  ids,
  accent,
  questionsById,
  expandedIds,
  details,
  resolveUrl,
  onToggleExpand,
  onMove,
  onRemove,
}: SelectedListProps) {
  // Estado del arrastre (los hooks van antes de cualquier return)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (ids.length === 0) return null
  const color = accent === 'orange' ? 'text-orange-400' : 'text-amber-400'

  const resetDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="space-y-2 pt-2">
      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        Orden final de la jornada {part} (así las verá el estudiante) · arrastra ⠿ para reordenar
      </h5>
      <ol className="max-h-[32rem] overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl divide-y divide-slate-800/60 p-1">
        {ids.map((id, index) => {
          const q = questionsById.get(id)
          const open = expandedIds.includes(id)
          const isDragging = dragIndex === index
          const isOver = overIndex === index && dragIndex !== null && dragIndex !== index
          // Línea indicadora: arriba si viene de abajo, abajo si viene de arriba
          const dropLine = isOver
            ? dragIndex! > index
              ? 'border-t-2 border-t-orange-500'
              : 'border-b-2 border-b-orange-500'
            : ''
          return (
            <li
              key={id}
              className={`p-2 transition-opacity ${isDragging ? 'opacity-40' : ''} ${dropLine}`}
              onDragOver={(e) => {
                if (dragIndex === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overIndex !== index) setOverIndex(index)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== null && dragIndex !== index) onMove(part, dragIndex, index)
                resetDrag()
              }}
            >
              <div className="flex items-center gap-2 text-xs">
                <span
                  draggable
                  title="Arrastra para cambiar de posición"
                  onDragStart={(e) => {
                    setDragIndex(index)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', id)
                    const row = (e.currentTarget as HTMLElement).closest('li')
                    if (row) e.dataTransfer.setDragImage(row, 20, 20)
                  }}
                  onDragEnd={resetDrag}
                  className="cursor-grab active:cursor-grabbing select-none px-1.5 py-0.5 text-slate-500 hover:text-white text-base leading-none"
                >
                  ⠿
                </span>
                <input
                  type="number"
                  min={1}
                  max={ids.length}
                  defaultValue={index + 1}
                  key={`${id}-${index}`}
                  onBlur={(e) => onMove(part, index, Number(e.target.value) - 1)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onMove(part, index, Number((e.target as HTMLInputElement).value) - 1)
                    }
                  }}
                  title="Escribe una posición y presiona Enter"
                  className={`w-12 bg-slate-900 border border-slate-800 rounded-lg px-1 py-0.5 text-center font-black ${color}`}
                />
                <span className={`font-bold shrink-0 ${color}`}>
                  [{q?.subjects?.name || 'General'}]
                </span>
                <span className="text-slate-200 truncate flex-1">
                  {q?.statement || '(pregunta no encontrada)'}
                </span>
                <span className="text-[9px] text-slate-600 shrink-0 font-mono">
                  #{id.slice(0, 4)}
                </span>

                <button
                  type="button"
                  onClick={() => onMove(part, index, index - 1)}
                  disabled={index === 0}
                  className="px-2 py-0.5 bg-slate-800 rounded disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(part, index, index + 1)}
                  disabled={index === ids.length - 1}
                  className="px-2 py-0.5 bg-slate-800 rounded disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onToggleExpand(id)}
                  className="px-2 py-0.5 bg-slate-800 rounded text-slate-300 shrink-0"
                >
                  {open ? '▴ Ocultar' : '▾ Ver'}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(id, part)}
                  className="px-2 py-0.5 bg-rose-500/10 text-rose-400 rounded"
                >
                  ✕
                </button>
              </div>
              {open && (
                <div className="mt-2">
                  <QuestionDetailView detail={details[id]} resolveUrl={resolveUrl} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function AdminSimulationsPage() {
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create')

  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Campos del formulario (Crear / Editar)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'corto' | 'normal_jornadas' | 'tesoro'>('corto')
  const [calendar, setCalendar] = useState('A')
  const [academicYear, setAcademicYear] = useState<number>(CURRENT_YEAR)
  const [targetInstitutionId, setTargetInstitutionId] = useState<string>('')
  const [isActive, setIsActive] = useState<boolean>(true)
  const [durationPart1, setDurationPart1] = useState(60)
  const [durationPart2, setDurationPart2] = useState(270)

  // Permisos válidos únicamente
  const [allowedRoles, setAllowedRoles] = useState<string[]>(['simulacro_unico', 'preicfes_completo'])

  // Selección de preguntas (el orden del arreglo ES el orden final)
  const [selectedQuestionsPart1, setSelectedQuestionsPart1] = useState<string[]>([])
  const [selectedQuestionsPart2, setSelectedQuestionsPart2] = useState<string[]>([])

  // Detalle desplegable de preguntas
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [details, setDetails] = useState<Record<string, QuestionDetail | 'error'>>({})

  // Filtro de materia para el selector de preguntas
  const [questionFilterSubject, setQuestionFilterSubject] = useState('')
  const [questionSearchTerm, setQuestionSearchTerm] = useState('')

  // Filtros de la lista de simulacros
  const [filterType, setFilterType] = useState('')
  const [filterCalendar, setFilterCalendar] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [filterInstitution, setFilterInstitution] = useState('')

  const supabase = createClient()

  // Recarga manual de datos tras operaciones
  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [simRes, qRes, subRes, instRes] = await Promise.all([
        supabase.from('simulations').select(SIMULATIONS_SELECT).order('created_at', { ascending: false }),
        supabase.from('questions').select('id, statement, subject_id, subjects(name)'),
        supabase.from('subjects').select('id, name').order('name'),
        supabase.from('institutions').select('id, name').order('name'),
      ])

      if (simRes.data) setSimulations(simRes.data as unknown as Simulation[])
      if (qRes.data) setQuestions(qRes.data as unknown as Question[])
      if (subRes.data) setSubjects(subRes.data)
      if (instRes.data) setInstitutions(instRes.data as Institution[])
      setLoading(false)
    },
    [supabase]
  )

  // Carga inicial optimizada
  useEffect(() => {
    let isMounted = true

    const fetchInitialData = async () => {
      const [simRes, qRes, subRes, instRes] = await Promise.all([
        supabase.from('simulations').select(SIMULATIONS_SELECT).order('created_at', { ascending: false }),
        supabase.from('questions').select('id, statement, subject_id, subjects(name)'),
        supabase.from('subjects').select('id, name').order('name'),
        supabase.from('institutions').select('id, name').order('name'),
      ])

      if (isMounted) {
        if (simRes.data) setSimulations(simRes.data as unknown as Simulation[])
        if (qRes.data) setQuestions(qRes.data as unknown as Question[])
        if (subRes.data) setSubjects(subRes.data)
        if (instRes.data) setInstitutions(instRes.data as Institution[])
        setLoading(false)
      }
    }

    fetchInitialData()

    return () => {
      isMounted = false
    }
  }, [supabase])

  // Mapa id -> pregunta (para mostrar la lista ordenada sin depender del banco)
  const questionsById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  // Base de preguntas filtradas por materia y búsqueda
  const baseFilteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const matchesSub = questionFilterSubject === '' || q.subject_id === questionFilterSubject
      const matchesSearch =
        questionSearchTerm.trim() === '' ||
        q.statement.toLowerCase().includes(questionSearchTerm.toLowerCase())
      return matchesSub && matchesSearch
    })
  }, [questions, questionFilterSubject, questionSearchTerm])

  // Preguntas visibles en Jornada 1
  const questionsForPart1 = useMemo(() => {
    return baseFilteredQuestions.filter((q) => !selectedQuestionsPart2.includes(q.id))
  }, [baseFilteredQuestions, selectedQuestionsPart2])

  // Preguntas visibles en Jornada 2
  const questionsForPart2 = useMemo(() => {
    return baseFilteredQuestions.filter((q) => !selectedQuestionsPart1.includes(q.id))
  }, [baseFilteredQuestions, selectedQuestionsPart1])

  // Filtro para la lista de simulacros
  const filteredSimulations = useMemo(() => {
    return simulations.filter((sim) => {
      const matchesType = filterType === '' || sim.type === filterType
      const matchesCal = filterCalendar === '' || sim.calendar === filterCalendar
      const matchesYear = filterYear === '' || sim.academic_year === Number(filterYear)
      const matchesInst = filterInstitution === '' || sim.target_institution_id === filterInstitution
      return matchesType && matchesCal && matchesYear && matchesInst
    })
  }, [simulations, filterType, filterCalendar, filterYear, filterInstitution])

  // Convierte una ruta de storage en URL pública (si ya es URL completa, la deja igual)
  const resolveUrl = useCallback(
    (value: string | null): string | null => {
      if (!value) return null
      if (/^https?:\/\//i.test(value)) return value
      return supabase.storage.from('questions').getPublicUrl(value).data.publicUrl
    },
    [supabase]
  )

  // Carga la pregunta completa solo al desplegarla (no pesa al abrir la página)
  const toggleExpand = async (id: string) => {
    if (expandedIds.includes(id)) {
      setExpandedIds((prev) => prev.filter((x) => x !== id))
      return
    }
    setExpandedIds((prev) => [...prev, id])
    if (details[id] && details[id] !== 'error') return

    const { data, error } = await supabase
      .from('questions')
      .select('statement, image_url, options(id, option_letter, option_text, option_image_url, is_correct)')
      .eq('id', id)
      .single()

    if (error || !data) {
      setDetails((prev) => ({ ...prev, [id]: 'error' }))
    } else {
      setDetails((prev) => ({ ...prev, [id]: data as unknown as QuestionDetail }))
    }
  }

  const toggleQuestionSelection = (questionId: string, part: 1 | 2) => {
    if (part === 1) {
      setSelectedQuestionsPart1((prev) =>
        prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]
      )
    } else {
      setSelectedQuestionsPart2((prev) =>
        prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]
      )
    }
  }

  // Mueve una pregunta de la posición "from" a la posición "to" (índices desde 0)
  const moveQuestion = (part: 1 | 2, from: number, to: number) => {
    if (Number.isNaN(to)) return
    const setter = part === 1 ? setSelectedQuestionsPart1 : setSelectedQuestionsPart2
    setter((prev) => {
      const target = Math.max(0, Math.min(prev.length - 1, to))
      if (from === target) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const handleRoleToggle = (role: string) => {
    if (allowedRoles.includes(role)) {
      setAllowedRoles(allowedRoles.filter((r) => r !== role))
    } else {
      setAllowedRoles([...allowedRoles, role])
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setDescription('')
    setType('corto')
    setCalendar('A')
    setAcademicYear(CURRENT_YEAR)
    setTargetInstitutionId('')
    setIsActive(true)
    setDurationPart1(60)
    setDurationPart2(270)
    setAllowedRoles(['simulacro_unico', 'preicfes_completo'])
    setSelectedQuestionsPart1([])
    setSelectedQuestionsPart2([])
    setExpandedIds([])
  }

  // Alternar estado de activación
  const toggleActiveStatus = async (simId: string, currentActiveStatus: boolean) => {
    const { error } = await supabase
      .from('simulations')
      .update({ is_active: !currentActiveStatus })
      .eq('id', simId)

    if (error) {
      alert(`Error al actualizar estado: ${error.message}`)
    } else {
      await loadData(true)
    }
  }

  // Crear o Editar Simulacro
  const handleSubmitSimulation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    if (selectedQuestionsPart1.length === 0) {
      alert('Selecciona al menos una pregunta para la primera jornada.')
      return
    }

    setSubmitting(true)

    // Filtrar estrictamente para enviar unicamente valores aceptados por el ENUM en Supabase
    const finalAllowedRoles = allowedRoles.filter((role) => VALID_SUBSCRIPTIONS.includes(role))

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      calendar,
      academic_year: academicYear,
      target_institution_id: targetInstitutionId || null,
      is_active: isActive,
      duration_minutes_part1: durationPart1,
      duration_minutes_part2: type === 'normal_jornadas' ? durationPart2 : 0,
      allowed_roles: finalAllowedRoles,
      is_treasure_active: type === 'tesoro',
    }

    let simId = editingId

    if (editingId) {
      const { error: updateErr } = await supabase.from('simulations').update(payload).eq('id', editingId)

      if (updateErr) {
        alert(`Error actualizando simulacro: ${updateErr.message}`)
        setSubmitting(false)
        return
      }
    } else {
      const { data: simData, error: simError } = await supabase
        .from('simulations')
        .insert(payload)
        .select()
        .single()

      if (simError || !simData) {
        alert(`Error al crear simulacro: ${simError?.message}`)
        setSubmitting(false)
        return
      }
      simId = simData.id
    }

    // Sincronizar preguntas vinculadas
    if (simId) {
      // Respaldo de las preguntas actuales por si el guardado falla a medias
      const { data: backupRows } = await supabase
        .from('simulation_questions')
        .select('simulation_id, question_id, section_part, question_order')
        .eq('simulation_id', simId)

      const { error: delError } = await supabase
        .from('simulation_questions')
        .delete()
        .eq('simulation_id', simId)

      if (delError) {
        alert(`Error al reemplazar preguntas: ${delError.message}`)
        setSubmitting(false)
        return
      }

      const questionsPayload = [
        ...selectedQuestionsPart1.map((qId, index) => ({
          simulation_id: simId,
          question_id: qId,
          section_part: 1,
          question_order: index + 1,
        })),
        ...(type === 'normal_jornadas'
          ? selectedQuestionsPart2.map((qId, index) => ({
              simulation_id: simId,
              question_id: qId,
              section_part: 2,
              question_order: index + 1,
            }))
          : []),
      ]

      const { error: relError } = await supabase.from('simulation_questions').insert(questionsPayload)

      if (relError) {
        // Intentar restaurar lo que había antes para no dejar el simulacro vacío
        if (backupRows && backupRows.length > 0) {
          const { error: restoreError } = await supabase.from('simulation_questions').insert(backupRows)
          alert(
            restoreError
              ? `Error al guardar preguntas: ${relError.message}\n\nATENCIÓN: no se pudo restaurar el orden anterior. Revisa este simulacro antes de usarlo.`
              : `Error al guardar preguntas: ${relError.message}\n\nSe restauró la versión anterior del simulacro.`
          )
        } else {
          alert(`Error al guardar preguntas: ${relError.message}`)
        }
      } else {
        alert(editingId ? '¡Simulacro actualizado!' : '¡Simulacro creado exitosamente!')
        resetForm()
        await loadData()
      }
    }

    setSubmitting(false)
  }

  const handleEdit = (sim: Simulation) => {
    setEditingId(sim.id)
    setTitle(sim.title)
    setDescription(sim.description || '')
    setType(sim.type)
    setCalendar(sim.calendar || 'A')
    setAcademicYear(sim.academic_year || CURRENT_YEAR)
    setTargetInstitutionId(sim.target_institution_id || '')
    setIsActive(sim.is_active)
    setDurationPart1(sim.duration_minutes_part1)
    setDurationPart2(sim.duration_minutes_part2 || 270)

    // Filtramos explícitamente cualquier valor antiguo como 'admin' al cargar el simulacro a edición
    const cleanRoles = (sim.allowed_roles || VALID_SUBSCRIPTIONS).filter((r) =>
      VALID_SUBSCRIPTIONS.includes(r)
    )
    setAllowedRoles(cleanRoles)

    // IMPORTANTE: ordenar por question_order ANTES de separar por jornada,
    // así el orden guardado se conserva al editar.
    const sorted = [...(sim.simulation_questions || [])].sort(
      (a, b) => (a.question_order ?? 0) - (b.question_order ?? 0)
    )
    const part1 = sorted.filter((sq) => sq.section_part === 1).map((sq) => sq.question_id)
    const part2 = sorted.filter((sq) => sq.section_part === 2).map((sq) => sq.question_id)

    setSelectedQuestionsPart1(part1)
    setSelectedQuestionsPart2(part2)
    setExpandedIds([])

    setActiveTab('create')
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Seguro que deseas eliminar este simulacro?')) return

    const { error } = await supabase.from('simulations').delete().eq('id', id)
    if (error) {
      alert(`Error al eliminar: ${error.message}`)
    } else {
      await loadData(true)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 text-xs font-semibold space-y-3">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p>Cargando módulo de simulacros...</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 selection:bg-orange-500 selection:text-white">
      {/* Luces Ambientales Naranja */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto space-y-6">
        {/* Encabezado */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-black uppercase tracking-wider rounded-lg">
                Evaluaciones Globales
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Creador de <span className="text-orange-500">Simulacros</span>
            </h1>
            <p className="text-xs text-slate-400">
              Gestión de exámenes, activación/desactivación manual y asignación a colegios o suscripciones
            </p>
          </div>

          <Link
            href="/admin"
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all self-start md:self-auto"
          >
            ← Volver al Panel
          </Link>
        </div>

        {/* Pestañas de Navegación */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'create'
                ? 'bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {editingId ? '✏️ Editando Simulacro' : '➕ Crear Simulacro'}
          </button>

          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'list'
                ? 'bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span>📋 Simulacros Creados</span>
            <span className="px-2 py-0.5 bg-slate-950/80 text-white rounded-md text-[10px] font-black">
              {simulations.length}
            </span>
          </button>
        </div>

        {/* PESTAÑA 1: FORMULARIO */}
        {activeTab === 'create' && (
          <form
            onSubmit={handleSubmitSimulation}
            className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <span>⚙️</span> {editingId ? 'Modificar Simulacro' : '1. Configuración General'}
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1 bg-slate-800 text-slate-300 font-bold text-xs rounded-lg hover:bg-slate-700"
                >
                  Cancelar Edición ✖
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Título del Simulacro *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Simulacro Oficial ICFES 2026 - Jornada Completa"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Tipo de Simulacro
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'corto' | 'normal_jornadas' | 'tesoro')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="corto">Simulacro Corto (1 Sesión - Tiempo Personalizado)</option>
                  <option value="normal_jornadas">Simulacro Normal ICFES (2 Jornadas con Descanso)</option>
                  <option value="tesoro">Simulacro Tipo Tesoro (Competencia y Ranking)</option>
                </select>
              </div>
            </div>

            {/* Segmentación */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Colegio Específico (Opcional)
                </label>
                <select
                  value={targetInstitutionId}
                  onChange={(e) => setTargetInstitutionId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="">-- Todos los Colegios --</option>
                  {institutions.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Calendario *
                </label>
                <select
                  value={calendar}
                  onChange={(e) => setCalendar(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer font-bold"
                >
                  <option value="A">Calendario A</option>
                  <option value="B">Calendario B</option>
                  <option value="G">Calendario G</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Año / Cohorte *
                </label>
                <select
                  value={academicYear}
                  onChange={(e) => setAcademicYear(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer font-bold"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      Año {y}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Estado Inicial
                </label>
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  className={`w-full p-2.5 rounded-xl text-xs font-bold transition-all border ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  {isActive ? '● Activo (Visible)' : '○ Inactivo (Oculto)'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Descripción / Instrucciones
              </label>
              <textarea
                rows={2}
                placeholder="Indicaciones para los alumnos antes de iniciar..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
              />
            </div>

            {/* Duración */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Duración Jornada 1 / Sesión Única (Minutos)
                </label>
                <input
                  type="number"
                  min={5}
                  required
                  value={durationPart1}
                  onChange={(e) => setDurationPart1(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500"
                />
                <p className="text-[10px] font-semibold text-orange-400 mt-1">
                  ⏱ {durationPart1} min ({Math.floor(durationPart1 / 60)}h {durationPart1 % 60}m)
                </p>
              </div>

              {type === 'normal_jornadas' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Duración Jornada 2 (Minutos)
                  </label>
                  <input
                    type="number"
                    min={5}
                    required
                    value={durationPart2}
                    onChange={(e) => setDurationPart2(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500"
                  />
                  <p className="text-[10px] font-semibold text-orange-400 mt-1">
                    ⏱ {durationPart2} min ({Math.floor(durationPart2 / 60)}h {durationPart2 % 60}m)
                  </p>
                </div>
              )}
            </div>

            {/* Permisos */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Permisos de Acceso por Suscripción
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedRoles.includes('simulacro_unico')}
                    onChange={() => handleRoleToggle('simulacro_unico')}
                    className="accent-orange-500 h-4 w-4 rounded"
                  />
                  <span>Usuarios Simulacro Único</span>
                </label>

                <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedRoles.includes('preicfes_completo')}
                    onChange={() => handleRoleToggle('preicfes_completo')}
                    className="accent-orange-500 h-4 w-4 rounded"
                  />
                  <span>Usuarios PreICFES Completo</span>
                </label>
              </div>
            </div>

            {/* Asignación de Preguntas Exclusivas */}
            <div className="border-t border-slate-800 pt-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>🎯</span> 2. Asignación de Preguntas desde el Banco
                </h3>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="🔍 Buscar pregunta..."
                    value={questionSearchTerm}
                    onChange={(e) => setQuestionSearchTerm(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                  />

                  <select
                    value={questionFilterSubject}
                    onChange={(e) => setQuestionFilterSubject(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer"
                  >
                    <option value="">-- Todas las Materias --</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Contenedor Jornada 1 */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider">
                  Preguntas Jornada 1 / Sesión Única ({selectedQuestionsPart1.length} seleccionadas)
                </h4>
                <div className="max-h-64 overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl divide-y divide-slate-800/60 p-1">
                  {questionsForPart1.length === 0 ? (
                    <p className="p-4 text-center text-xs text-slate-500">
                      No hay preguntas disponibles o fueron seleccionadas en la Jornada 2.
                    </p>
                  ) : (
                    questionsForPart1.map((q) => (
                      <div key={q.id} className="p-1">
                        <div className="p-1.5 flex items-center space-x-3 hover:bg-slate-900/60 text-xs rounded-xl transition-colors">
                          <label className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedQuestionsPart1.includes(q.id)}
                              onChange={() => toggleQuestionSelection(q.id, 1)}
                              className="accent-orange-500 h-4 w-4 shrink-0"
                            />
                            <span className="font-bold text-orange-400 shrink-0">
                              [{q.subjects?.name || 'General'}]
                            </span>
                            <span className="text-slate-200 truncate">{q.statement}</span>
                          </label>
                          <span className="text-[9px] text-slate-600 shrink-0 font-mono">
                            #{q.id.slice(0, 4)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleExpand(q.id)}
                            className="px-2 py-0.5 bg-slate-800 rounded text-slate-300 shrink-0"
                          >
                            {expandedIds.includes(q.id) ? '▴' : '▾ Ver'}
                          </button>
                        </div>
                        {expandedIds.includes(q.id) && (
                          <div className="mt-1 mb-1">
                            <QuestionDetailView detail={details[q.id]} resolveUrl={resolveUrl} />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <SelectedQuestionsList
                  part={1}
                  ids={selectedQuestionsPart1}
                  accent="orange"
                  questionsById={questionsById}
                  expandedIds={expandedIds}
                  details={details}
                  resolveUrl={resolveUrl}
                  onToggleExpand={toggleExpand}
                  onMove={moveQuestion}
                  onRemove={toggleQuestionSelection}
                />
              </div>

              {/* Contenedor Jornada 2 */}
              {type === 'normal_jornadas' && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    Preguntas Jornada 2 ({selectedQuestionsPart2.length} seleccionadas)
                  </h4>
                  <div className="max-h-64 overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl divide-y divide-slate-800/60 p-1">
                    {questionsForPart2.length === 0 ? (
                      <p className="p-4 text-center text-xs text-slate-500">
                        No hay preguntas disponibles o fueron seleccionadas en la Jornada 1.
                      </p>
                    ) : (
                      questionsForPart2.map((q) => (
                        <div key={q.id} className="p-1">
                          <div className="p-1.5 flex items-center space-x-3 hover:bg-slate-900/60 text-xs rounded-xl transition-colors">
                            <label className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedQuestionsPart2.includes(q.id)}
                                onChange={() => toggleQuestionSelection(q.id, 2)}
                                className="accent-amber-500 h-4 w-4 shrink-0"
                              />
                              <span className="font-bold text-amber-400 shrink-0">
                                [{q.subjects?.name || 'General'}]
                              </span>
                              <span className="text-slate-200 truncate">{q.statement}</span>
                            </label>
                            <span className="text-[9px] text-slate-600 shrink-0 font-mono">
                              #{q.id.slice(0, 4)}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleExpand(q.id)}
                              className="px-2 py-0.5 bg-slate-800 rounded text-slate-300 shrink-0"
                            >
                              {expandedIds.includes(q.id) ? '▴' : '▾ Ver'}
                            </button>
                          </div>
                          {expandedIds.includes(q.id) && (
                            <div className="mt-1 mb-1">
                              <QuestionDetailView detail={details[q.id]} resolveUrl={resolveUrl} />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <SelectedQuestionsList
                    part={2}
                    ids={selectedQuestionsPart2}
                    accent="amber"
                    questionsById={questionsById}
                    expandedIds={expandedIds}
                    details={details}
                    resolveUrl={resolveUrl}
                    onToggleExpand={toggleExpand}
                    onMove={moveQuestion}
                    onRemove={toggleQuestionSelection}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-orange-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {submitting
                ? 'Guardando...'
                : editingId
                ? 'Actualizar Simulacro'
                : 'Guardar y Publicar Simulacro'}
            </button>
          </form>
        )}

        {/* PESTAÑA 2: VISOR Y LISTA COMPLETA */}
        {activeTab === 'list' && (
          <div className="space-y-4">
            {/* Filtros de la Lista */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shadow-xl backdrop-blur-xl">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Filtrar por Colegio
                </label>
                <select
                  value={filterInstitution}
                  onChange={(e) => setFilterInstitution(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="">-- Todos los Colegios --</option>
                  {institutions.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Filtrar por Tipo
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="">-- Todos los Tipos --</option>
                  <option value="corto">Corto</option>
                  <option value="normal_jornadas">Normal (2 Jornadas)</option>
                  <option value="tesoro">Tesoro</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Filtrar por Calendario
                </label>
                <select
                  value={filterCalendar}
                  onChange={(e) => setFilterCalendar(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="">-- Todos los Calendarios --</option>
                  <option value="A">Calendario A</option>
                  <option value="B">Calendario B</option>
                  <option value="G">Calendario G</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Filtrar por Año
                </label>
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="">-- Todos los Años --</option>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      Año {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Listado de Simulacros */}
            {filteredSimulations.length === 0 ? (
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-12 text-center space-y-2">
                <p className="text-3xl">📭</p>
                <p className="text-xs font-bold text-slate-300">
                  No se encontraron simulacros con estos filtros.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredSimulations.map((sim) => (
                  <div
                    key={sim.id}
                    className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            sim.is_active
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                          }`}
                        >
                          {sim.is_active ? '● Activo' : '○ Inactivo'}
                        </span>

                        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-bold uppercase">
                          {sim.type === 'normal_jornadas'
                            ? '2 Jornadas'
                            : sim.type === 'tesoro'
                            ? 'Tesoro'
                            : 'Corto'}
                        </span>

                        <span className="px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded text-[10px] font-bold">
                          Cal. {sim.calendar} - {sim.academic_year}
                        </span>

                        {sim.institutions?.name && (
                          <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded text-[10px] font-bold">
                            🏫 {sim.institutions.name}
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-white pt-1">{sim.title}</h3>
                      {sim.description && <p className="text-xs text-slate-400">{sim.description}</p>}

                      <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-slate-400">
                        <span>⏱ J1: {sim.duration_minutes_part1} min</span>
                        {sim.type === 'normal_jornadas' && <span>| J2: {sim.duration_minutes_part2} min</span>}
                        <span>| 🎯 {sim.simulation_questions?.length || 0} Preguntas</span>
                      </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-center">
                      <button
                        onClick={() => toggleActiveStatus(sim.id, sim.is_active)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors border ${
                          sim.is_active
                            ? 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-400'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                        }`}
                      >
                        {sim.is_active ? 'Desactivar' : 'Activar'}
                      </button>

                      <button
                        onClick={() => handleEdit(sim)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-400 font-bold text-xs rounded-xl transition-colors"
                      >
                        ✏️ Editar
                      </button>

                      <button
                        onClick={() => handleDelete(sim.id)}
                        className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-xs rounded-xl transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}