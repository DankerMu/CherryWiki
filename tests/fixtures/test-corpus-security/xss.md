# XSS Test Document

Normal paragraph before attack vectors.

## Script Injection

<script>alert('xss')</script>

## Event Handler Injection

<img src=x onerror="alert('xss')">

## SVG Injection

<svg onload="alert('xss')">

## Link Injection

[Click me](javascript:alert('xss'))

## Data URI

<a href="data:text/html,<script>alert('xss')</script>">link</a>

## Style Injection

<div style="background:url('javascript:alert(1)')">styled</div>

## Normal Content After

This paragraph should render normally after all attack vectors are sanitized.
