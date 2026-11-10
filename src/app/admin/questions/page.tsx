// RUTA: app/admin/questions/page.tsx   (banco de preguntas del administrador)
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Subject {
  id: string
  name: string
}

interface OptionInput {
  id?: string
  letter: string
  text: string
  imageUrl: string
  isCorrect: boolean
}

interface QuestionItem {
  id: string
  statement: string
  image_url: string | null
  explanation: string | null
  subject_id: string
  created_at: string
  upload_position: number | null
  options: {
    id: string
    option_letter: string
    option_text: string | null
    option_image_url: string | null
    is_correct: boolean
  }[]
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
const PAGE_SIZE = 20
const MAX_IMAGE_MB = 5

const defaultOptions = (): OptionInput[] => [
  { letter: 'A', text: '', imageUrl: '', isCorrect: true },
  { letter: 'B', text: '', imageUrl: '', isCorrect: false },
  { letter: 'C', text: '', imageUrl: '', isCorrect: false },
  { letter: 'D', text: '', imageUrl: '', isCorrect: false },
]

export default function AdminQuestionsPage() {
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create')

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubject, setSelectedSubject] = useState('all')
  const [newSubjectName, setNewSubjectName] = useState('')

  // Estado para preguntas cargadas (SOLO la página actual)
  const [existingQuestions, setExistingQuestions] = useState<QuestionItem[]>([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  // Paginación en servidor
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0) // total con filtros (materia + búsqueda)
  const [subjectCount, setSubjectCount] = useState(0) // total de la materia seleccionada
  const [totalAll, setTotalAll] = useState(0) // total de todo el banco
  const [refreshKey, setRefreshKey] = useState(0) // sube para forzar recarga

  // Estado del formulario de preguntas (Crear / Editar)
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [originalOptionIds, setOriginalOptionIds] = useState<string[]>([])
  const [statement, setStatement] = useState('')
  const [questionImageUrl, setQuestionImageUrl] = useState('')
  const [explanation, setExplanation] = useState('')

  // Control de subida de imágenes
  const [uploadingQuestionImg, setUploadingQuestionImg] = useState(false)
  const [uploadingOptionIdx, setUploadingOptionIdx] = useState<number | null>(null)

  // Opciones iniciales
  const [options, setOptions] = useState<OptionInput[]>(defaultOptions())

  // Modal de confirmación para eliminar materia
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [deletingSubject, setDeletingSubject] = useState(false)

  const [loadingSubjects, setLoadingSubjects] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Cliente estable: no se recrea en cada render
  const [supabase] = useState(() => createClient())

  const requestIdRef = useRef(0)
  const lastSearchRef = useRef('')
  const listTopRef = useRef<HTMLDivElement | null>(null)

  const reloadList = () => setRefreshKey((k) => k + 1)

  // Cargar Materias
  const loadSubjects = useCallback(async () => {
    setLoadingSubjects(true)
    const { data, error } = await supabase.from('subjects').select('*').order('name')
    if (error) console.error('Error cargando materias:', error)
    if (data) setSubjects(data)
    setLoadingSubjects(false)
  }, [supabase])

  // Cargar materias en el montaje inicial
  useEffect(() => {
    let isMounted = true

    const fetchInitialSubjects = async () => {
      const { data, error } = await supabase.from('subjects').select('*').order('name')
      if (!isMounted) return
      if (error) console.error('Error cargando materias:', error)
      if (data) setSubjects(data)
      setLoadingSubjects(false)
    }

    fetchInitialSubjects()

    return () => {
      isMounted = false
    }
  }, [supabase])

  // Debounce de la búsqueda (400 ms) y regreso a la página 1
  useEffect(() => {
    const term = searchQuery.trim()
    if (term === lastSearchRef.current) return
    const t = setTimeout(() => {
      lastSearchRef.current = term
      setDebouncedSearch(term)
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Conteos reales (total del banco y total de la materia seleccionada)
  useEffect(() => {
    let isMounted = true

    const fetchCounts = async () => {
      const { count: all } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
      if (!isMounted) return
      setTotalAll(all ?? 0)

      if (selectedSubject === 'all') {
        setSubjectCount(all ?? 0)
      } else {
        const { count: sub } = await supabase
          .from('questions')
          .select('*', { count: 'exact', head: true })
          .eq('subject_id', selectedSubject)
        if (isMounted) setSubjectCount(sub ?? 0)
      }
    }

    fetchCounts()

    return () => {
      isMounted = false
    }
  }, [supabase, selectedSubject, refreshKey])

  // Cargar la página actual de preguntas (filtro por materia + búsqueda + orden en servidor)
  useEffect(() => {
    const reqId = ++requestIdRef.current

    const fetchQuestions = async () => {
      setLoadingQuestions(true)

      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const asc = sortOrder === 'oldest'

      let query = supabase
        .from('questions')
        .select(
          `
          id,
          statement,
          image_url,
          explanation,
          subject_id,
          created_at,
          upload_position,
          options (
            id,
            option_letter,
            option_text,
            option_image_url,
            is_correct
          )
        `,
          { count: 'exact' }
        )
        .order('upload_position', { ascending: asc, nullsFirst: !asc })
        .order('created_at', { ascending: asc })
        .order('id', { ascending: asc }) // desempate estable para paginar
        .range(from, to)

      if (selectedSubject && selectedSubject !== 'all') {
        query = query.eq('subject_id', selectedSubject)
      }

      if (debouncedSearch) {
        const numeric = debouncedSearch.replace('#', '')
        if (/^\d{1,9}$/.test(numeric)) {
          // Número: coincide con el número de pregunta o aparece en el texto
          query = query.or(`upload_position.eq.${numeric},statement.ilike.%${numeric}%`)
        } else {
          // Texto: se escapan los comodines de LIKE para buscar literalmente
          const escaped = debouncedSearch.replace(/[\\%_]/g, '\\$&')
          query = query.ilike('statement', `%${escaped}%`)
        }
      }

      const { data, error, count } = await query

      // Respuesta vieja: la ignoramos, ya hay una más reciente en camino
      if (reqId !== requestIdRef.current) return

      if (error) {
        // Página fuera de rango (ej. se borró la última): volver a la 1
        if (error.code === 'PGRST103' && page > 1) {
          setPage(1)
          return
        }
        console.error('Error cargando preguntas:', error)
        setExistingQuestions([])
        setTotalCount(0)
        setLoadingQuestions(false)
        return
      }

      const total = count ?? 0

      // Si la página quedó vacía pero hay resultados, ir a la última página válida
      if ((data?.length ?? 0) === 0 && total > 0 && page > 1) {
        setPage(Math.ceil(total / PAGE_SIZE))
        return
      }

      setExistingQuestions((data ?? []) as unknown as QuestionItem[])
      setTotalCount(total)
      setLoadingQuestions(false)
    }

    fetchQuestions()
  }, [supabase, selectedSubject, page, debouncedSearch, sortOrder, refreshKey])

  // Validación de archivos de imagen
  const validateImageFile = (file: File): boolean => {
    if (!file.type.startsWith('image/')) {
      alert('El archivo debe ser una imagen.')
      return false
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      alert(`La imagen supera el límite de ${MAX_IMAGE_MB} MB.`)
      return false
    }
    return true
  }

  // Subir archivo a Supabase Storage
  const uploadImageToStorage = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
      const filePath = `questions/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('questions')
        .upload(filePath, file)

      if (uploadError) {
        alert(`Error subiendo imagen: ${uploadError.message}`)
        return null
      }

      const { data } = supabase.storage.from('questions').getPublicUrl(filePath)
      return data.publicUrl
    } catch (err) {
      console.error('Error procesando imagen:', err)
      return null
    }
  }

  const handleQuestionImageUpload = async (file: File) => {
    if (!validateImageFile(file)) return
    setUploadingQuestionImg(true)
    const url = await uploadImageToStorage(file)
    if (url) setQuestionImageUrl(url)
    setUploadingQuestionImg(false)
  }

  const handleOptionImageUpload = async (index: number, file: File) => {
    if (!validateImageFile(file)) return
    setUploadingOptionIdx(index)
    const url = await uploadImageToStorage(file)
    if (url) {
      setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, imageUrl: url } : o)))
    }
    setUploadingOptionIdx(null)
  }

  const addOption = () => {
    setOptions((prev) => {
      if (prev.length >= LETTERS.length) return prev
      return [
        ...prev,
        { letter: LETTERS[prev.length], text: '', imageUrl: '', isCorrect: false },
      ]
    })
  }

  const removeOption = () => {
    setOptions((prev) => {
      if (prev.length <= 2) return prev
      const next = prev.slice(0, -1).map((o) => ({ ...o }))
      if (!next.some((o) => o.isCorrect)) {
        next[0].isCorrect = true
      }
      return next
    })
  }

  const handleOptionTextChange = (index: number, text: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, text } : o)))
  }

  const handleRemoveOptionImage = (index: number) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, imageUrl: '' } : o)))
  }

  const handleSetCorrect = (index: number) => {
    setOptions((prev) => prev.map((opt, i) => ({ ...opt, isCorrect: i === index })))
  }

  // Cargar datos en el formulario para editar
  const handleEditQuestion = (question: QuestionItem) => {
    setEditingQuestionId(question.id)
    // Guardamos los ids originales: la lista paginada puede cambiar mientras se edita
    setOriginalOptionIds(question.options?.map((o) => o.id) ?? [])
    setStatement(question.statement)
    setQuestionImageUrl(question.image_url || '')
    setExplanation(question.explanation || '')

    if (question.subject_id) {
      setSelectedSubject(question.subject_id)
    }

    if (question.options && question.options.length > 0) {
      const sortedOptions = [...question.options].sort((a, b) =>
        a.option_letter.localeCompare(b.option_letter)
      )
      setOptions(
        sortedOptions.map((o) => ({
          id: o.id,
          letter: o.option_letter,
          text: o.option_text || '',
          imageUrl: o.option_image_url || '',
          isCorrect: o.is_correct,
        }))
      )
    }
    setActiveTab('create')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Cancelar Edición / Limpiar Formulario
  const resetForm = () => {
    setEditingQuestionId(null)
    setOriginalOptionIds([])
    setStatement('')
    setQuestionImageUrl('')
    setExplanation('')
    setOptions(defaultOptions())
  }

  // Cambio de materia desde el selector
  const handleSubjectChange = (value: string) => {
    setSelectedSubject(value)
    setPage(1)
    resetForm()
  }

  // Cambio de orden
  const handleSortChange = (value: 'newest' | 'oldest') => {
    setSortOrder(value)
    setPage(1)
  }

  // Cambio de página (con scroll al inicio de la lista)
  const goToPage = (p: number) => {
    setPage(p)
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Eliminar una pregunta
  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm('¿Estás seguro de eliminar esta pregunta? Se borrarán sus opciones vinculadas.')) {
      return
    }

    const { error } = await supabase.from('questions').delete().eq('id', questionId)

    if (error) {
      alert(
        `No se pudo eliminar la pregunta: ${error.message}\n\nSi la pregunta está dentro de un simulacro o ya fue respondida por estudiantes, no se puede borrar.`
      )
    } else {
      alert('Pregunta eliminada con éxito.')
      reloadList()
    }
  }

  // Crear nueva materia
  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSubjectName.trim()) return

    const { data, error } = await supabase
      .from('subjects')
      .insert({ name: newSubjectName.trim() })
      .select()
      .single()

    if (error) {
      alert(`Error creando materia: ${error.message}`)
    } else if (data) {
      setNewSubjectName('')
      await loadSubjects()
      setSelectedSubject(data.id)
      setPage(1)
    }
  }

  // Eliminar materia con clave de admin
  const handleDeleteSubjectWithAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminPassword || !selectedSubject || selectedSubject === 'all') return

    setDeletingSubject(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) {
      alert('Error obteniendo datos del usuario activo.')
      setDeletingSubject(false)
      return
    }

    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: adminPassword,
    })

    if (authErr) {
      alert('Contraseña incorrecta. No se pudo eliminar la materia.')
      setDeletingSubject(false)
      return
    }

    const { error: deleteErr } = await supabase
      .from('subjects')
      .delete()
      .eq('id', selectedSubject)

    if (deleteErr) {
      alert(`Error eliminando materia: ${deleteErr.message}`)
    } else {
      alert('Materia eliminada correctamente.')
      setShowDeleteModal(false)
      setAdminPassword('')
      setSelectedSubject('all')
      setPage(1)
      await loadSubjects()
      reloadList()
    }

    setDeletingSubject(false)
  }

  // Guardar / Actualizar pregunta
  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSubject || selectedSubject === 'all') {
      alert('Por favor selecciona una materia específica para guardar la pregunta.')
      return
    }
    if (!statement.trim()) {
      alert('Escribe el enunciado de la pregunta.')
      return
    }
    const emptyOption = options.find((o) => !o.text.trim() && !o.imageUrl.trim())
    if (emptyOption) {
      alert(`La opción ${emptyOption.letter} no tiene texto ni imagen.`)
      return
    }

    setSubmitting(true)

    // OJO: se respetan los saltos de línea (no se hace trim interno, solo en los extremos)
    const questionPayload = {
      subject_id: selectedSubject,
      statement: statement.trim(),
      image_url: questionImageUrl.trim() || null,
      explanation: explanation.trim() || null,
    }

    if (editingQuestionId) {
      const { error: qError } = await supabase
        .from('questions')
        .update(questionPayload)
        .eq('id', editingQuestionId)

      if (qError) {
        alert(`Error al actualizar la pregunta: ${qError.message}`)
        setSubmitting(false)
        return
      }

      // EDICIÓN SEGURA DE OPCIONES:
      // Se actualizan las existentes por id, se insertan las nuevas y solo
      // se borran las que el admin quitó (para no romper respuestas de estudiantes).
      const keptIds = options.filter((o) => o.id).map((o) => o.id as string)
      const idsToDelete = originalOptionIds.filter((id) => !keptIds.includes(id))

      let optionsError: string | null = null

      if (idsToDelete.length > 0) {
        const { error: delErr } = await supabase.from('options').delete().in('id', idsToDelete)
        if (delErr) {
          optionsError =
            'No se pudieron quitar algunas opciones porque ya fueron respondidas por estudiantes. Se dejaron como estaban y no se agregaron opciones nuevas.'
        }
      }

      if (!optionsError) {
        for (const opt of options.filter((o) => o.id)) {
          const { error: updErr } = await supabase
            .from('options')
            .update({
              option_letter: opt.letter,
              option_text: opt.text.trim() || null,
              option_image_url: opt.imageUrl.trim() || null,
              is_correct: opt.isCorrect,
            })
            .eq('id', opt.id as string)

          if (updErr) {
            optionsError = `Error al actualizar la opción ${opt.letter}: ${updErr.message}`
            break
          }
        }
      }

      const newOptions = options
        .filter((o) => !o.id)
        .map((opt) => ({
          question_id: editingQuestionId,
          option_letter: opt.letter,
          option_text: opt.text.trim() || null,
          option_image_url: opt.imageUrl.trim() || null,
          is_correct: opt.isCorrect,
        }))

      if (!optionsError && newOptions.length > 0) {
        const { error: insErr } = await supabase.from('options').insert(newOptions)
        if (insErr) optionsError = `Error al agregar opciones nuevas: ${insErr.message}`
      }

      if (optionsError) {
        alert(optionsError)
      } else {
        alert('¡Pregunta actualizada con éxito!')
      }
      resetForm()
      reloadList()
    } else {
      // El número de orden de subida (upload_position) lo asigna la base de datos solo
      const { data: questionData, error: qError } = await supabase
        .from('questions')
        .insert(questionPayload)
        .select()
        .single()

      if (qError || !questionData) {
        alert(`Error al guardar la pregunta: ${qError?.message}`)
        setSubmitting(false)
        return
      }

      const optionsPayload = options.map((opt) => ({
        question_id: questionData.id,
        option_letter: opt.letter,
        option_text: opt.text.trim() || null,
        option_image_url: opt.imageUrl.trim() || null,
        is_correct: opt.isCorrect,
      }))

      const { error: optError } = await supabase.from('options').insert(optionsPayload)

      if (optError) {
        // Rollback: no dejar la pregunta huérfana (sin opciones)
        await supabase.from('questions').delete().eq('id', questionData.id)
        alert(`Error al guardar las opciones: ${optError.message}\n\nLa pregunta no se guardó. Intenta de nuevo.`)
      } else {
        alert('¡Pregunta guardada con éxito!')
        resetForm()
        reloadList()
      }
    }

    setSubmitting(false)
  }

  // Datos de paginación para mostrar
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount)

  const paginationControls = totalCount > PAGE_SIZE && (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => goToPage(1)}
        disabled={page <= 1 || loadingQuestions}
        className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-300 font-bold text-xs rounded-xl disabled:opacity-40 hover:border-orange-500/50 transition-all"
      >
        « Primera
      </button>
      <button
        type="button"
        onClick={() => goToPage(page - 1)}
        disabled={page <= 1 || loadingQuestions}
        className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-300 font-bold text-xs rounded-xl disabled:opacity-40 hover:border-orange-500/50 transition-all"
      >
        ← Anterior
      </button>

      <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
        <span>Página</span>
        <select
          value={page}
          onChange={(e) => goToPage(Number(e.target.value))}
          disabled={loadingQuestions}
          className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span>de {totalPages}</span>
      </div>

      <button
        type="button"
        onClick={() => goToPage(page + 1)}
        disabled={page >= totalPages || loadingQuestions}
        className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-300 font-bold text-xs rounded-xl disabled:opacity-40 hover:border-orange-500/50 transition-all"
      >
        Siguiente →
      </button>
      <button
        type="button"
        onClick={() => goToPage(totalPages)}
        disabled={page >= totalPages || loadingQuestions}
        className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-300 font-bold text-xs rounded-xl disabled:opacity-40 hover:border-orange-500/50 transition-all"
      >
        Última »
      </button>
    </div>
  )

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 selection:bg-orange-500 selection:text-white font-sans">
      
      {/* Luces Ambientales */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto space-y-6">
        
        {/* Encabezado */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-black uppercase tracking-wider rounded-lg">
                Módulo Evaluativo
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Banco de <span className="text-orange-500">Preguntas</span>
            </h1>
            <p className="text-xs text-slate-400">
              Creación, edición y retroalimentación pedagógica de preguntas por materia
            </p>
          </div>

          <Link
            href="/admin"
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all self-start md:self-auto"
          >
            ← Volver al Panel
          </Link>
        </div>

        {/* Sección 1: Materia o Área del Saber */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-4">
          <h2 className="text-base font-black text-white flex items-center gap-2">
            <span>📚</span> Materia o Área del Saber
          </h2>

          {loadingSubjects ? (
            <p className="text-xs text-slate-400 font-semibold">Cargando materias...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Materia Seleccionada
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedSubject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer"
                  >
                    <option value="all">🌐 Todas las materias ({totalAll} preguntas)</option>
                    {subjects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>

                  {selectedSubject && selectedSubject !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-xs rounded-xl transition-all"
                      title="Eliminar esta materia"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleCreateSubject} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nueva Materia (Ej: Inglés)"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl whitespace-nowrap border border-slate-700 transition-all"
                >
                  + Crear
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Navegación por Pestañas */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'create'
                ? 'bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {editingQuestionId ? '✏️ Editando Pregunta' : '➕ Crear Pregunta'}
          </button>

          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'list'
                ? 'bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span>📋 Preguntas Guardadas</span>
            <span className="px-2 py-0.5 bg-slate-950/80 text-white rounded-md text-[10px] font-black">
              {subjectCount}
            </span>
          </button>
        </div>

        {/* PESTAÑA 1: FORMULARIO CREAR / EDITAR */}
        {activeTab === 'create' && (
          <form onSubmit={handleSaveQuestion} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <span>📝</span> {editingQuestionId ? 'Modificar Pregunta' : '2. Enunciado y Contexto'}
              </h2>
              {editingQuestionId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1 bg-slate-800 text-slate-300 font-bold text-xs rounded-lg hover:bg-slate-700"
                >
                  Cancelar Edición ✖
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Enunciado / Texto de la pregunta *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Escribe aquí la pregunta o lectura de apoyo..."
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Explicación Pedagógica Opcional */}
              <div>
                <label className="block text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span>💡</span> Explicación / Retroalimentación Pedagógica (Opcional)
                </label>
                <textarea
                  rows={6}
                  placeholder="Justifica por qué la opción correcta es la acertada. Usa Enter para separar párrafos: se verán igual en la revisión del estudiante..."
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  className="w-full bg-indigo-950/20 border border-indigo-500/30 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Zona Drag & Drop de Imagen */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Imagen para el Enunciado (Arrastra un archivo o pega la URL)
                </label>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (e.dataTransfer.files?.[0]) {
                      handleQuestionImageUpload(e.dataTransfer.files[0])
                    }
                  }}
                  className="border-2 border-dashed border-slate-800 hover:border-orange-500/50 bg-slate-950 rounded-2xl p-4 text-center cursor-pointer transition-all space-y-2"
                >
                  {uploadingQuestionImg ? (
                    <p className="text-xs text-orange-400 font-bold animate-pulse">Subiendo imagen a Supabase Storage...</p>
                  ) : questionImageUrl ? (
                    <div className="space-y-2">
                      <img src={questionImageUrl} alt="Pregunta" className="max-h-40 mx-auto rounded-lg border border-slate-800" />
                      <button
                        type="button"
                        onClick={() => setQuestionImageUrl('')}
                        className="text-[10px] font-bold text-rose-400 hover:underline"
                      >
                        Quitar Imagen
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-slate-400">Arrastra aquí una imagen o haz clic para subir</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleQuestionImageUpload(file)
                          e.target.value = ''
                        }}
                        className="hidden"
                        id="question-img-input"
                      />
                      <label htmlFor="question-img-input" className="text-[10px] font-bold text-orange-400 cursor-pointer hover:underline block mt-1">
                        Seleccionar Archivo Local
                      </label>
                    </div>
                  )}
                </div>

                <input
                  type="url"
                  placeholder="O pega una URL externa: https://..."
                  value={questionImageUrl}
                  onChange={(e) => setQuestionImageUrl(e.target.value)}
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Opciones de Respuesta */}
            <div className="border-t border-slate-800 pt-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-base font-black text-white flex items-center gap-2">
                  <span>🎯</span> 3. Opciones de Respuesta
                </h2>
                <div className="space-x-2">
                  <button
                    type="button"
                    onClick={addOption}
                    disabled={options.length >= LETTERS.length}
                    className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 font-bold text-xs rounded-xl disabled:opacity-40 transition-all border border-orange-500/20"
                  >
                    + Opción ({LETTERS[options.length] || 'Máx'})
                  </button>
                  <button
                    type="button"
                    onClick={removeOption}
                    disabled={options.length <= 2}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-xs rounded-xl disabled:opacity-40 transition-all border border-rose-500/20"
                  >
                    - Quitar Última
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {options.map((opt, idx) => (
                  <div
                    key={opt.letter}
                    className={`p-4 rounded-2xl border transition-all ${
                      opt.isCorrect
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-slate-800 bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-black text-white text-xs">Opción {opt.letter}</span>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="correct_option"
                          checked={opt.isCorrect}
                          onChange={() => handleSetCorrect(idx)}
                          className="accent-emerald-500 h-4 w-4 cursor-pointer"
                        />
                        <span className={`text-xs font-bold ${opt.isCorrect ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {opt.isCorrect ? '✓ Respuesta Correcta' : 'Marcar Correcta'}
                        </span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder={`Texto opción ${opt.letter}`}
                        value={opt.text}
                        onChange={(e) => handleOptionTextChange(idx, e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-orange-500"
                      />

                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (e.dataTransfer.files?.[0]) {
                            handleOptionImageUpload(idx, e.dataTransfer.files[0])
                          }
                        }}
                        className="border border-slate-800 bg-slate-900 rounded-xl p-2 flex items-center justify-between text-xs"
                      >
                        {uploadingOptionIdx === idx ? (
                          <span className="text-[10px] text-orange-400 font-bold animate-pulse">Subiendo...</span>
                        ) : opt.imageUrl ? (
                          <div className="flex items-center gap-2 w-full justify-between">
                            <img src={opt.imageUrl} alt={`Opción ${opt.letter}`} className="h-8 rounded" />
                            <button
                              type="button"
                              onClick={() => handleRemoveOptionImage(idx)}
                              className="text-[10px] text-rose-400 font-bold"
                            >
                              Quitar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] text-slate-500">Arrastra una imagen aquí</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleOptionImageUpload(idx, file)
                                e.target.value = ''
                              }}
                              className="hidden"
                              id={`opt-img-${idx}`}
                            />
                            <label htmlFor={`opt-img-${idx}`} className="text-[10px] font-bold text-orange-400 cursor-pointer hover:underline">
                              Examinar
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-orange-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {submitting
                ? 'Guardando...'
                : editingQuestionId
                ? 'Actualizar Pregunta'
                : 'Guardar Pregunta en el Banco'}
            </button>
          </form>
        )}

        {/* PESTAÑA 2: VISOR / LISTA DE PREGUNTAS GUARDADAS */}
        {activeTab === 'list' && (
          <div ref={listTopRef} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-4 scroll-mt-4">
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex flex-col sm:flex-row gap-2 w-full lg:max-w-xl">
                <input
                  type="text"
                  placeholder="🔍 Buscar por texto o por número (ej: 25)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                />
                <select
                  value={sortOrder}
                  onChange={(e) => handleSortChange(e.target.value as 'newest' | 'oldest')}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500 cursor-pointer shrink-0"
                >
                  <option value="newest">↓ Más recientes primero</option>
                  <option value="oldest">↑ Más antiguas primero</option>
                </select>
              </div>
              <span className="text-xs font-bold text-slate-400">
                Mostrando {rangeFrom}-{rangeTo} de {totalCount}
              </span>
            </div>

            {paginationControls}

            {loadingQuestions ? (
              <div className="text-center py-12 space-y-2">
                <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-400 font-semibold">Cargando preguntas...</p>
              </div>
            ) : existingQuestions.length === 0 ? (
              <div className="text-center py-12 space-y-2 border-2 border-dashed border-slate-800 rounded-2xl">
                <p className="text-2xl">📭</p>
                <p className="text-xs font-bold text-slate-300">No hay preguntas registradas con este filtro</p>
                <p className="text-[11px] text-slate-500">Usa la pestaña Crear Pregunta o selecciona Todas las materias.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {existingQuestions.map((q) => (
                  <div key={q.id} className="p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    
                    {/* Encabezado de Pregunta */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Número fijo: no cambia con filtros ni búsquedas */}
                          <span className="px-2 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded text-[10px] font-black">
                            Pregunta #{q.upload_position ?? '—'}
                          </span>
                          {q.subject_id && (
                            <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[10px] font-bold">
                              {subjects.find((s) => s.id === q.subject_id)?.name || 'Materia'}
                            </span>
                          )}
                          <span className="px-2 py-0.5 bg-slate-900 text-slate-500 rounded text-[10px] font-semibold">
                            📅 {new Date(q.created_at).toLocaleDateString('es-CO')}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-100 leading-relaxed pt-1 whitespace-pre-line">
                          {q.statement}
                        </p>
                      </div>

                      {/* Botones de Acción */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleEditQuestion(q)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-[11px] rounded-lg transition-colors border border-slate-700"
                          title="Editar pregunta"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => handleDeleteQuestion(q.id)}
                          className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-[11px] rounded-lg transition-colors border border-rose-500/20"
                          title="Eliminar pregunta"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Imagen del Enunciado si tiene */}
                    {q.image_url && (
                      <div className="pt-1">
                        <img src={q.image_url} alt="Enunciado" className="max-h-48 rounded-lg border border-slate-800" />
                      </div>
                    )}

                    {/* Explicación Pedagógica si tiene */}
                    {q.explanation && (
                      <div className="p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-xl space-y-1">
                        <span className="text-[10px] font-black uppercase text-indigo-400 flex items-center gap-1">
                          💡 Retroalimentación Pedagógica
                        </span>
                        <p className="text-[11px] text-slate-300 whitespace-pre-line">{q.explanation}</p>
                      </div>
                    )}

                    {/* Opciones de la Pregunta */}
                    {q.options && q.options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-900">
                        {[...q.options]
                          .sort((a, b) => a.option_letter.localeCompare(b.option_letter))
                          .map((opt) => (
                            <div
                              key={opt.id}
                              className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                                opt.is_correct
                                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-bold'
                                  : 'bg-slate-900 border-slate-800/80 text-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                  opt.is_correct ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                                }`}>
                                  {opt.option_letter}
                                </span>
                                <span>{opt.option_text || '(Sin texto)'}</span>
                              </div>
                              {opt.is_correct && <span className="text-[10px] text-emerald-400">✓ Correcta</span>}
                            </div>
                          ))}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}

            {!loadingQuestions && existingQuestions.length > 0 && paginationControls}

          </div>
        )}

      </div>

      {/* Modal Confirmación Borrar Materia */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-black text-rose-400 flex items-center gap-2">
              ⚠️ Eliminar Materia
            </h3>
            <p className="text-xs text-slate-300">
              Ingresa tu contraseña de administrador para confirmar la eliminación de esta materia.
            </p>
            <form onSubmit={handleDeleteSubjectWithAuth} className="space-y-3">
              <input
                type="password"
                required
                placeholder="Contraseña del administrador"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false)
                    setAdminPassword('')
                  }}
                  className="w-1/2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deletingSubject}
                  className="w-1/2 py-2 bg-rose-500 hover:bg-rose-600 font-bold text-xs rounded-xl text-white disabled:opacity-50"
                >
                  {deletingSubject ? 'Eliminando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}