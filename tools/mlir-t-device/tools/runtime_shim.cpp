// Runtime shim: the portable-mlir-toolchain (LLVM 22.1.8) was built against an
// older MSVC STL that emitted out-of-line calls to the vectorized algorithm helpers
// __std_remove_8 / __std_remove_1 / __std_min_8u / __std_mismatch_8 and to the UCRT
// _Thrd_sleep_for. Our local MSVC 14.37.32822 STL no longer exports these symbols
// (they were moved to header-only / removed), so we provide them here. The linker
// resolves by name only; these implementations are faithful enough for a build/verify
// tool and are generally not exercised by a trivial lowering such as vec_add.
#include <cstddef>
#include <cstring>
#include <cstdint>

// std::remove (element size 8), returns new logical-last pointer.
extern "C" void* __cdecl __std_remove_8(void* _First, void* _Last, const void* _Val, size_t /*_Size*/) {
  unsigned char* first = static_cast<unsigned char*>(_First);
  unsigned char* last = static_cast<unsigned char*>(_Last);
  const unsigned char* val = static_cast<const unsigned char*>(_Val);
  unsigned char* dest = first;
  for (; first != last; first += 8) {
    if (std::memcmp(first, val, 8) != 0) {
      if (dest != first) std::memcpy(dest, first, 8);
      dest += 8;
    }
  }
  return dest;
}

// std::remove (element size 1), returns new logical-last pointer.
extern "C" void* __cdecl __std_remove_1(void* _First, void* _Last, const void* _Val, size_t /*_Size*/) {
  unsigned char* first = static_cast<unsigned char*>(_First);
  unsigned char* last = static_cast<unsigned char*>(_Last);
  unsigned char val = *static_cast<const unsigned char*>(_Val);
  unsigned char* dest = first;
  for (; first != last; ++first) {
    if (*first != val) {
      if (dest != first) *dest = *first;
      ++dest;
    }
  }
  return dest;
}

// std::min_element (unsigned 8-byte elements), returns pointer to minimum.
extern "C" void* __cdecl __std_min_8u(void* _First, void* _Last, size_t /*_Size*/) {
  unsigned char* first = static_cast<unsigned char*>(_First);
  unsigned char* last = static_cast<unsigned char*>(_Last);
  if (first == last) return first;
  unsigned char* minp = first;
  std::uint64_t minv = *reinterpret_cast<const std::uint64_t*>(first);
  for (first += 8; first != last; first += 8) {
    std::uint64_t v = *reinterpret_cast<const std::uint64_t*>(first);
    if (v < minv) { minv = v; minp = first; }
  }
  return minp;
}

// std::mismatch (8-byte elements); returns the first mismatching position in range 1.
extern "C" void* __cdecl __std_mismatch_8(void* _First1, void* _First2, void* _Last1, size_t /*_Size*/) {
  unsigned char* f1 = static_cast<unsigned char*>(_First1);
  unsigned char* f2 = static_cast<unsigned char*>(_First2);
  unsigned char* l1 = static_cast<unsigned char*>(_Last1);
  for (; f1 != l1; f1 += 8, f2 += 8) {
    if (std::memcmp(f1, f2, 8) != 0) return f1;
  }
  return l1;
}

struct _xtime { long long sec; long nsec; };

extern "C" void __stdcall Sleep(unsigned long);

// C11 _Thrd_sleep_for: sleep for the requested duration (clamped to avoid hangs).
extern "C" int __cdecl _Thrd_sleep_for(const _xtime* xt, _xtime* rem) {
  (void)rem;
  long long ms = 0;
  if (xt) {
    ms = xt->sec * 1000 + xt->nsec / 1000000;
  }
  if (ms < 0) ms = 0;
  if (ms > 100) ms = 100; // safety clamp for a verify tool
  if (ms > 0) Sleep(static_cast<unsigned long>(ms));
  return 0;
}

// std::search (1-byte elements): first occurrence of [_F2, _F2+_N) in [_F1, _L1); else _L1.
extern "C" const char* __cdecl __std_search_1(const char* _F1, const char* _L1, const char* _F2, size_t _N) {
  if (_N == 0) return _F1;
  size_t len = (size_t)(_L1 - _F1);
  if (len < _N) return _L1;
  for (size_t i = 0; i + _N <= len; ++i) {
    if (std::memcmp(_F1 + i, _F2, _N) == 0) return _F1 + i;
  }
  return _L1;
}

// std::find_end (1-byte elements): last occurrence of [_F2, _F2+_N) in [_F1, _L1); else _L1.
extern "C" const char* __cdecl __std_find_end_1(const char* _F1, const char* _L1, const char* _F2, size_t _N) {
  if (_N == 0) return _L1;
  size_t len = (size_t)(_L1 - _F1);
  if (len < _N) return _L1;
  const char* result = _L1;
  for (size_t i = 0; i + _N <= len; ++i) {
    if (std::memcmp(_F1 + i, _F2, _N) == 0) result = _F1 + i;
  }
  return result;
}
