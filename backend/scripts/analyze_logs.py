#!/usr/bin/env python3
"""
Utilidad para analizar logs JSON estructurados de EcuPlotWeb.

Uso:
    python backend/scripts/analyze_logs.py app.log
    python backend/scripts/analyze_logs.py app.log --filter "event=auth.login.failed"
    python backend/scripts/analyze_logs.py app.log --stats
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from typing import Dict, List, Any


def parse_log_line(line: str) -> Dict[str, Any] | None:
    """Parse una línea de log JSON."""
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def filter_logs(logs: List[Dict], filter_expr: str) -> List[Dict]:
    """Filtra logs por expresión simple (key=value)."""
    if not filter_expr:
        return logs
    
    key, value = filter_expr.split('=', 1)
    return [log for log in logs if log.get(key) == value]


def print_log_entry(log: Dict, colored: bool = True):
    """Imprime una entrada de log formateada."""
    level = log.get('level', 'INFO')
    timestamp = log.get('timestamp', '')
    message = log.get('message', '')
    request_id = log.get('request_id', '')
    
    # Colores ANSI
    colors = {
        'DEBUG': '\033[36m',    # Cyan
        'INFO': '\033[32m',     # Green
        'WARNING': '\033[33m',  # Yellow
        'ERROR': '\033[31m',    # Red
        'CRITICAL': '\033[35m', # Magenta
        'RESET': '\033[0m',
    }
    
    if colored:
        color = colors.get(level, '')
        reset = colors['RESET']
    else:
        color = reset = ''
    
    print(f"{color}[{timestamp}] {level:8s}{reset} {message}")
    
    if request_id:
        print(f"  request_id: {request_id[:8]}...")
    
    # Mostrar campos adicionales relevantes
    extra_fields = ['event', 'user_id', 'email', 'path', 'status_code', 
                    'response_time_ms', 'error_type']
    extras = {k: v for k, v in log.items() if k in extra_fields and v is not None}
    
    if extras:
        for key, value in extras.items():
            print(f"  {key}: {value}")
    
    print()


def generate_stats(logs: List[Dict]):
    """Genera estadísticas de los logs."""
    print("\n" + "=" * 80)
    print("ESTADÍSTICAS DE LOGS")
    print("=" * 80 + "\n")
    
    # Total de logs
    print(f"Total de entradas: {len(logs)}\n")
    
    # Logs por nivel
    level_counts = Counter(log.get('level') for log in logs)
    print("Logs por nivel:")
    for level, count in level_counts.most_common():
        print(f"  {level:8s}: {count:6d}")
    print()
    
    # Logs por evento
    event_counts = Counter(log.get('event') for log in logs if log.get('event'))
    if event_counts:
        print("Top 10 eventos:")
        for event, count in event_counts.most_common(10):
            print(f"  {event:40s}: {count:6d}")
        print()
    
    # Errores por tipo
    error_counts = Counter(
        log.get('error_type') for log in logs 
        if log.get('error_type') and log.get('level') in ['ERROR', 'CRITICAL']
    )
    if error_counts:
        print("Errores por tipo:")
        for error_type, count in error_counts.most_common():
            print(f"  {error_type:40s}: {count:6d}")
        print()
    
    # Usuarios más activos
    user_counts = Counter(log.get('user_id') for log in logs if log.get('user_id'))
    if user_counts:
        print("Top 10 usuarios más activos:")
        for user_id, count in user_counts.most_common(10):
            print(f"  {user_id}: {count:6d}")
        print()
    
    # Tiempo de respuesta promedio
    response_times = [
        log.get('response_time_ms') for log in logs 
        if log.get('response_time_ms') is not None
    ]
    if response_times:
        avg_response = sum(response_times) / len(response_times)
        max_response = max(response_times)
        min_response = min(response_times)
        print(f"Tiempos de respuesta (ms):")
        print(f"  Promedio: {avg_response:.2f}")
        print(f"  Mínimo:   {min_response:.2f}")
        print(f"  Máximo:   {max_response:.2f}")
        print()
    
    # Rutas más accedidas
    path_counts = Counter(log.get('path') for log in logs if log.get('path'))
    if path_counts:
        print("Top 10 rutas más accedidas:")
        for path, count in path_counts.most_common(10):
            print(f"  {path:40s}: {count:6d}")
        print()


def main():
    """Función principal."""
    if len(sys.argv) < 2:
        print("Uso: python analyze_logs.py <log_file> [--filter key=value] [--stats]")
        sys.exit(1)
    
    log_file = sys.argv[1]
    filter_expr = None
    show_stats = False
    
    # Parsear argumentos
    if '--filter' in sys.argv:
        filter_idx = sys.argv.index('--filter')
        if filter_idx + 1 < len(sys.argv):
            filter_expr = sys.argv[filter_idx + 1]
    
    if '--stats' in sys.argv:
        show_stats = True
    
    # Leer y parsear logs
    logs = []
    try:
        with open(log_file, 'r') as f:
            for line in f:
                log = parse_log_line(line.strip())
                if log:
                    logs.append(log)
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo {log_file}")
        sys.exit(1)
    except Exception as e:
        print(f"Error al leer el archivo: {e}")
        sys.exit(1)
    
    # Aplicar filtros
    if filter_expr:
        logs = filter_logs(logs, filter_expr)
        print(f"\n{len(logs)} logs que coinciden con: {filter_expr}\n")
    
    # Mostrar estadísticas o logs
    if show_stats:
        generate_stats(logs)
    else:
        for log in logs:
            print_log_entry(log)
        
        print(f"\nTotal: {len(logs)} entradas")


if __name__ == '__main__':
    main()
